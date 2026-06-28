#!/usr/bin/env node
/**
 * Interactive setup: collects Telegram API credentials (once) and creates the
 * login session. Safe to re-run — it reuses an existing config/session.
 *
 *   npx telegram-user-mcp setup
 *
 * Credentials live in $HOME, never in this package:
 *   ~/.telegram-mcp-config.json   { apiId, apiHash, phoneNumber }
 *   ~/.telegram-mcp-session       GramJS StringSession (full account access — keep secret)
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const CONFIG_PATH  = path.join(process.env.HOME, '.telegram-mcp-config.json');

/** Load existing config, or prompt for the pieces that are missing and save it. */
async function loadOrCreateConfig() {
    let cfg = {};
    if (fs.existsSync(CONFIG_PATH)) {
        cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
    if (!cfg.apiId || !cfg.apiHash) {
        console.log('\nGet your api_id and api_hash from https://my.telegram.org → "API development tools".\n');
        cfg.apiId   = Number(await input.text('api_id (number): '));
        cfg.apiHash = (await input.text('api_hash: ')).trim();
    }
    if (!cfg.phoneNumber) {
        cfg.phoneNumber = (await input.text('Your phone number (e.g. +9725...): ')).trim();
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    console.log(`💾 Config saved to ${CONFIG_PATH}`);
    return cfg;
}

async function main() {
    const { apiId, apiHash, phoneNumber } = await loadOrCreateConfig();

    let sessionStr = '';
    if (fs.existsSync(SESSION_PATH)) {
        sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();
        console.log('📋 Existing session found — verifying it...');
    }

    const client = new TelegramClient(new StringSession(sessionStr), Number(apiId), apiHash, {
        connectionRetries: 3,
    });

    await client.start({
        phoneNumber: async () => phoneNumber,
        password:    async () => await input.text('2FA password (leave blank if none): '),
        phoneCode:   async () => await input.text('Login code Telegram just sent you: '),
        onError:     (err) => console.error('Auth error:', err),
    });

    const me = await client.getMe();
    console.log(`✅ Authenticated as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);

    fs.writeFileSync(SESSION_PATH, client.session.save());
    console.log(`💾 Session saved to ${SESSION_PATH}`);
    console.log('\n🎉 Setup complete. Register the server in your MCP client and you are ready.\n');

    await client.disconnect();
    process.exit(0);
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
