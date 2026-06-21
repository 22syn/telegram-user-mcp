#!/usr/bin/env node
/**
 * Full auth using client.start() with code pre-written to /tmp/tg-code.txt
 * Write the SMS code to /tmp/tg-code.txt BEFORE running this script.
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH  = path.join(process.env.HOME, '.telegram-mcp-config.json');
const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const CODE_FILE    = '/tmp/tg-code.txt';

const { apiId, apiHash, phoneNumber } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

(async () => {
    const session = new StringSession('');
    const client = new TelegramClient(session, Number(apiId), apiHash, { connectionRetries: 3 });

    await client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
            // Wait up to 90s for code to appear in the file
            for (let i = 0; i < 90; i++) {
                if (fs.existsSync(CODE_FILE)) {
                    const code = fs.readFileSync(CODE_FILE, 'utf8').trim();
                    fs.unlinkSync(CODE_FILE);
                    return code;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            throw new Error('Timed out waiting for code file');
        },
        password: async () => {
            const PWD_FILE = '/tmp/tg-password.txt';
            for (let i = 0; i < 120; i++) {
                if (fs.existsSync(PWD_FILE)) {
                    const pwd = fs.readFileSync(PWD_FILE, 'utf8').trim();
                    fs.unlinkSync(PWD_FILE);
                    return pwd;
                }
                await new Promise(r => setTimeout(r, 1000));
            }
            throw new Error('Timed out waiting for 2FA password file');
        },
        onError: (err) => { throw err; },
    });

    const me = await client.getMe();
    const saved = client.session.save();
    fs.writeFileSync(SESSION_PATH, saved);
    console.log(`✅ Authenticated: ${me.firstName} (@${me.username || 'no-username'})`);
    console.log(`💾 Session saved: ${SESSION_PATH}`);
    await client.disconnect();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
