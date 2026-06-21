#!/usr/bin/env node
/**
 * Two-step auth helper.
 * Step 1 (no args):   sends SMS, saves phoneCodeHash to /tmp/tg-auth-hash
 * Step 2 (--code X):  completes sign-in with the code, saves session
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH  = path.join(process.env.HOME, '.telegram-mcp-config.json');
const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const HASH_PATH    = '/tmp/tg-auth-hash.json';

const { apiId, apiHash, phoneNumber } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const codeArg = (() => {
    const i = process.argv.indexOf('--code');
    return i >= 0 ? process.argv[i + 1] : null;
})();

(async () => {
    const session = new StringSession(
        fs.existsSync(SESSION_PATH) ? fs.readFileSync(SESSION_PATH, 'utf8').trim() : ''
    );
    const client = new TelegramClient(session, Number(apiId), apiHash, { connectionRetries: 3 });
    await client.connect();

    if (!codeArg) {
        // Step 1 — request code
        const result = await client.sendCode({ apiId: Number(apiId), apiHash }, phoneNumber);
        fs.writeFileSync(HASH_PATH, JSON.stringify({ phoneCodeHash: result.phoneCodeHash }));
        console.log('✅ SMS sent! Now run:  node auth2.js --code <CODE>');
        await client.disconnect();
        return;
    }

    // Step 2 — sign in
    const { phoneCodeHash } = JSON.parse(fs.readFileSync(HASH_PATH, 'utf8'));
    try {
        await client.invoke(new (require('telegram/tl').Api.auth.SignIn)({
            phoneNumber,
            phoneCodeHash,
            phoneCode: codeArg,
        }));
    } catch (e) {
        if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
            console.error('❌ 2FA enabled — need password support. Tell me and I will add it.');
            await client.disconnect();
            process.exit(1);
        }
        throw e;
    }

    const me = await client.getMe();
    const saved = client.session.save();
    fs.writeFileSync(SESSION_PATH, saved);
    console.log(`✅ Authenticated as: ${me.firstName} (@${me.username || 'no-username'})`);
    console.log(`💾 Session saved: ${SESSION_PATH}`);
    await client.disconnect();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
