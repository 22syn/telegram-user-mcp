#!/usr/bin/env node
/**
 * Telegram auth — reads phone code from PHONE_CODE env var.
 * Usage:
 *   node auth3.js --request-code     → sends SMS, saves hash
 *   PHONE_CODE=12345 node auth3.js   → signs in with the code
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram/tl');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH  = path.join(process.env.HOME, '.telegram-mcp-config.json');
const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const HASH_PATH    = '/tmp/tg-auth-hash.json';

const { apiId, apiHash, phoneNumber } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

(async () => {
    const session = new StringSession('');
    const client = new TelegramClient(session, Number(apiId), apiHash, { connectionRetries: 3 });
    await client.connect();

    if (process.argv.includes('--request-code')) {
        const result = await client.sendCode({ apiId: Number(apiId), apiHash }, phoneNumber);
        fs.writeFileSync(HASH_PATH, JSON.stringify({ phoneCodeHash: result.phoneCodeHash, ts: Date.now() }));
        console.log('📱 SMS sent to', phoneNumber);
        console.log('⏱  Code valid ~5 min. Run:  PHONE_CODE=XXXXX node auth3.js');
        await client.disconnect();
        return;
    }

    const code = process.env.PHONE_CODE;
    if (!code) {
        console.error('❌ Set PHONE_CODE env var or use --request-code');
        process.exit(1);
    }

    const { phoneCodeHash } = JSON.parse(fs.readFileSync(HASH_PATH, 'utf8'));

    try {
        await client.invoke(new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode: code }));
    } catch (e) {
        if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
            // 2FA - try with password
            const pwd = process.env.TG_PASSWORD;
            if (!pwd) {
                console.error('❌ 2FA is enabled. Set TG_PASSWORD=yourpassword and retry.');
                await client.disconnect();
                process.exit(1);
            }
            const { computeCheck } = require('telegram/Password');
            const r = await client.invoke(new Api.account.GetPassword());
            const check = await computeCheck(r, pwd);
            await client.invoke(new Api.auth.CheckPassword({ password: check }));
        } else {
            throw e;
        }
    }

    const me = await client.getMe();
    const saved = client.session.save();
    fs.writeFileSync(SESSION_PATH, saved);
    console.log(`✅ Authenticated as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
    console.log(`💾 Session: ${SESSION_PATH}`);
    await client.disconnect();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
