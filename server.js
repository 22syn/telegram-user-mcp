#!/usr/bin/env node
/**
 * Telegram MCP Server
 * Connects as the real Telegram user (MTProto) and exposes tools:
 *   - read_messages(groupUrl, limit)   → recent messages
 *   - search_messages(groupUrl, query) → keyword search
 *   - get_group_info(groupUrl)         → group metadata
 */
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

const SESSION_PATH = path.join(process.env.HOME, '.telegram-mcp-session');
const CONFIG_PATH  = path.join(process.env.HOME, '.telegram-mcp-config.json');

// ── Bootstrap ──────────────────────────────────────────────────────────────
if (!fs.existsSync(CONFIG_PATH)) throw new Error(`Config missing: ${CONFIG_PATH}`);
if (!fs.existsSync(SESSION_PATH)) throw new Error(`Session missing — run auth.js first`);

const { apiId, apiHash } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();

const client = new TelegramClient(new StringSession(sessionStr), Number(apiId), apiHash, {
    connectionRetries: 3,
});

// ── Helpers ────────────────────────────────────────────────────────────────
/** Resolve a group URL/username/id to a Telegram entity */
async function resolveGroup(groupUrl) {
    // Accept: https://t.me/foo, @foo, -100123456, "foo"
    let identifier = groupUrl
        .replace('https://t.me/', '')
        .replace('http://t.me/', '')
        .replace(/^@/, '');
    return await client.getEntity(identifier);
}

function formatMsg(msg) {
    const date = new Date(msg.date * 1000).toISOString().slice(0, 16).replace('T', ' ');
    const sender = msg.sender
        ? (msg.sender.username ? `@${msg.sender.username}` : msg.sender.firstName || 'Unknown')
        : 'Unknown';
    return `[${date}] ${sender}: ${msg.message || '[media/no text]'}`;
}

// ── MCP Server ─────────────────────────────────────────────────────────────
const server = new Server(
    { name: 'telegram-user', version: '1.0.0' },
    { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'read_messages',
            description: 'Read recent messages from a Telegram group/channel the user is a member of',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl: { type: 'string', description: 'Group URL (https://t.me/...) or @username or numeric id' },
                    limit:    { type: 'number', description: 'Number of messages to fetch (default 50, max 200)' },
                },
                required: ['groupUrl'],
            },
        },
        {
            name: 'search_messages',
            description: 'Search messages in a Telegram group by keyword',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl: { type: 'string', description: 'Group URL or @username' },
                    query:    { type: 'string', description: 'Search keyword' },
                    limit:    { type: 'number', description: 'Max results (default 30)' },
                },
                required: ['groupUrl', 'query'],
            },
        },
        {
            name: 'get_group_info',
            description: 'Get metadata about a Telegram group/channel (title, member count, description)',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl: { type: 'string', description: 'Group URL or @username' },
                },
                required: ['groupUrl'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'read_messages': {
                const entity = await resolveGroup(args.groupUrl);
                const limit  = Math.min(args.limit ?? 50, 200);
                const msgs   = await client.getMessages(entity, { limit });
                const lines  = msgs.reverse().map(formatMsg);
                return { content: [{ type: 'text', text: lines.join('\n') || '(no messages)' }] };
            }

            case 'search_messages': {
                const entity = await resolveGroup(args.groupUrl);
                const limit  = Math.min(args.limit ?? 30, 100);
                const msgs   = await client.getMessages(entity, { search: args.query, limit });
                const lines  = msgs.reverse().map(formatMsg);
                return {
                    content: [{ type: 'text', text: `Found ${msgs.length} messages for "${args.query}":\n` + (lines.join('\n') || '(none)') }],
                };
            }

            case 'get_group_info': {
                const entity = await resolveGroup(args.groupUrl);
                const info = [
                    `Title: ${entity.title || entity.firstName || 'N/A'}`,
                    `ID: ${entity.id}`,
                    `Username: ${entity.username ? '@' + entity.username : 'N/A'}`,
                    `Members: ${entity.participantsCount ?? 'N/A'}`,
                    `Type: ${entity.className}`,
                    entity.about ? `About: ${entity.about}` : null,
                ].filter(Boolean);
                return { content: [{ type: 'text', text: info.join('\n') }] };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (err) {
        return { content: [{ type: 'text', text: `❌ Error: ${err.message}` }], isError: true };
    }
});

// ── Start ──────────────────────────────────────────────────────────────────
(async () => {
    process.stderr.write('🔌 Connecting to Telegram...\n');
    await client.connect();
    process.stderr.write('✅ Telegram connected — MCP server ready\n');

    const transport = new StdioServerTransport();
    await server.connect(transport);
})();
