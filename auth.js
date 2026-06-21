#!/usr/bin/env node
/**
 * One-time auth: creates a Telegram session file.
 * Run once: node auth.js
 * Session saved to ~/.telegram-mcp-session
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const CONFIG_PATH = path.join(process.env.HOME, '.telegram-mcp-config.json');

async function main() {
    if (!fs.existsSync(CONFIG_PATH)) {
        console.error(`❌ Config not found: ${CONFIG_PATH}`);
        console.error(`Create it with: { "apiId": 12345, "apiHash": "abc...", "phoneNumber": "+972..." }`);
        process.exit(1);
    }

    const { apiId, apiHash, phoneNumber } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    let sessionStr = '';
    if (fs.existsSync(SESSION_PATH)) {
        sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();
        console.log('📋 Existing session found — testing it...');
    }

    const session = new StringSession(sessionStr);
    const client = new TelegramClient(session, Number(apiId), apiHash, {
        connectionRetries: 3,
    });

    await client.start({
        phoneNumber: async () => phoneNumber,
        password: async () => await input.text('2FA password (leave blank if none): '),
        phoneCode: async () => await input.text('SMS code from Telegram: '),
        onError: (err) => console.error('Auth error:', err),
    });

    const me = await client.getMe();
    console.log(`✅ Authenticated as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);

    const newSession = client.session.save();
    fs.writeFileSync(SESSION_PATH, newSession);
    console.log(`💾 Session saved to ${SESSION_PATH}`);

    await client.disconnect();
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
