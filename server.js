#!/usr/bin/env node
/**
 * Telegram MCP Server
 * Connects as the real Telegram user (MTProto) and exposes tools:
 *   - read_messages(groupUrl, limit)   → recent messages
 *   - search_messages(groupUrl, query) → keyword search
 *   - get_group_info(groupUrl)         → group metadata
 */
// ── stdio MCP protocol guard ─────────────────────────────────────────────────
// stdout is reserved for line-delimited JSON-RPC. Anything else on stdout breaks
// the client's JSON.parse (e.g. "Unexpected token '\x1b', \"[33m[2026\"...").
// GramJS's internal logger writes via console.log → stdout, so route every
// stdout-bound console.* through console.error (stderr). The MCP transport uses
// process.stdout.write directly and is unaffected.
console.log = console.info = console.debug = console.warn = (...a) => console.error(...a);

const { TelegramClient, Api, utils } = require('telegram');
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
if (!fs.existsSync(CONFIG_PATH) || !fs.existsSync(SESSION_PATH)) {
    console.error('❌ Not set up yet. Run:  npx telegram-user-mcp setup');
    console.error('   (creates ~/.telegram-mcp-config.json and logs in to Telegram)');
    process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { apiId, apiHash } = cfg;
const sessionStr = fs.readFileSync(SESSION_PATH, 'utf8').trim();

// Media downloads land here (override with "downloadDir" in config).
const DOWNLOAD_DIR    = cfg.downloadDir || path.join(process.env.HOME, '.telegram-mcp-downloads');
const MAX_DOWNLOAD_MB = cfg.maxDownloadMB ?? 200;
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const client = new TelegramClient(new StringSession(sessionStr), Number(apiId), apiHash, {
    connectionRetries: 3,
});
// Silence GramJS's own logger entirely (keeps even stderr clean of MTProto chatter).
client.setLogLevel('none');

// ── Helpers ────────────────────────────────────────────────────────────────
/** Resolve a group URL/username/id to a Telegram entity */
async function resolveGroup(groupUrl) {
    // Accept: https://t.me/foo, @foo, -1001234567890, 1234567890, "foo"
    const identifier = String(groupUrl)
        .replace(/^https?:\/\/t\.me\//, '')
        .replace(/^@/, '')
        .trim();
    // Numeric ids must be passed as a number (a string is read as a PeerUser).
    // A bare positive id from list_dialogs is a channel/supergroup, whose
    // canonical resolvable form is the -100… marked id — fall back to that.
    if (/^-?\d+$/.test(identifier)) {
        try {
            return await client.getEntity(Number(identifier));
        } catch (e) {
            if (/^\d+$/.test(identifier)) {
                return await client.getEntity(Number(`-100${identifier}`));
            }
            throw e;
        }
    }
    return await client.getEntity(identifier);
}

/** Telegram album id, as a STRING.
 *  An album (caption + N photos) arrives as N separate messages sharing one groupedId, so
 *  without it a consumer cannot tell that a caption belongs to the images posted beside it.
 *  MUST NOT go through toNum(): every value observed in a 30-day window exceeded
 *  Number.MAX_SAFE_INTEGER (e.g. 14285256815022452), so toJSNumber() silently corrupts them. */
function groupId(msg) {
    const g = msg.groupedId;
    return g == null ? null : String(g);
}

/** Id of the message this one replies to, or null.
 *  This is the only EXPLICIT link Telegram gives between two separate messages. Timing is not
 *  a substitute: a text-only message followed by a media-only message looks identical whether
 *  it is a caption meeting its media or two unrelated posts. A reply is an author action. */
function replyToId(msg) {
    const r = msg.replyTo?.replyToMsgId;
    return r == null ? null : Number(r);
}

function formatMsg(msg) {
    // Seconds matter: the album fallback for messages without a groupedId keys off a 2s
    // window, and a same-MINUTE rule would wrongly merge unrelated bursts.
    const date = new Date(msg.date * 1000).toISOString().slice(0, 19).replace('T', ' ');
    const sender = msg.sender
        ? (msg.sender.username ? `@${msg.sender.username}` : msg.sender.firstName || 'Unknown')
        : 'Unknown';
    // Surface the id (needed to target get_message/download_media) and a media tag.
    const media = msg.media ? ` [${mediaInfo(msg).type}]` : '';
    // Appended at the END so the `#(\d+)` id-cursor regex consumers use keeps matching.
    const rep = replyToId(msg) ? ` [reply:${replyToId(msg)}]` : '';
    const grp = groupId(msg) ? ` [album:${groupId(msg)}]` : '';
    return `#${msg.id} [${date}] ${sender}:${media} ${msg.message || '[no text]'}${rep}${grp}`;
}

/** Safely coerce GramJS BigInteger | number | null → JS number. */
function toNum(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v.toJSNumber === 'function') return v.toJSNumber();
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
}

/** Strip path separators / control chars from a candidate filename. */
function safeName(s) {
    return String(s).replace(/[/\\\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Describe a message's media without downloading it. */
function mediaInfo(msg) {
    if (!msg || !msg.media) return { type: 'none' };
    const m = msg.media;
    if (m.className === 'MessageMediaPhoto' || m.photo) {
        return { type: 'photo', mime: 'image/jpeg', sizeBytes: null, downloadable: true };
    }
    if (m.className === 'MessageMediaDocument' && m.document) {
        const doc   = m.document;
        const attrs = doc.attributes || [];
        const fn    = attrs.find(a => a.className === 'DocumentAttributeFilename');
        const vid   = attrs.find(a => a.className === 'DocumentAttributeVideo');
        const aud   = attrs.find(a => a.className === 'DocumentAttributeAudio');
        let type = 'document';
        if (vid) type = 'video';
        else if (aud) type = aud.voice ? 'voice' : 'audio';
        else if ((doc.mimeType || '').startsWith('image/')) type = 'image';
        return {
            type,
            mime: doc.mimeType || null,
            sizeBytes: toNum(doc.size),
            duration: vid?.duration ?? aud?.duration ?? null,
            fileName: fn?.fileName || null,
            downloadable: true,
        };
    }
    return { type: m.className || 'unknown', downloadable: false };
}

/** Pick a sensible file extension for a downloaded media object. */
function extFor(info) {
    if (info.fileName && info.fileName.includes('.')) return '';
    if (info.type === 'photo' || info.type === 'image') return '.jpg';
    const map = {
        'video/mp4': '.mp4', 'image/jpeg': '.jpg', 'image/png': '.png',
        'image/webp': '.webp', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
        'application/pdf': '.pdf', 'application/zip': '.zip',
    };
    if (info.mime && map[info.mime]) return map[info.mime];
    if (info.mime) { const sub = info.mime.split('/')[1]; if (sub) return '.' + sub.split(';')[0]; }
    return '.bin';
}

/** Telegram peer → stable string key for chat/user lookup maps. */
function peerKey(peer) {
    if (!peer) return null;
    return String(peer.channelId ?? peer.chatId ?? peer.userId ?? '');
}

/** Summarize engagement metadata on a single message. */
function msgMeta(msg) {
    const reactions = (msg.reactions?.results || []).reduce((s, r) => s + (r.count || 0), 0);
    return {
        views:    msg.views ?? null,
        forwards: msg.forwards ?? null,
        reactions,
        replies:  msg.replies?.replies ?? null,
        hasMedia: !!msg.media,
        albumId:  groupId(msg),
        replyTo:  replyToId(msg),
    };
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
        {
            name: 'fetch_since',
            description: 'Fetch only messages newer than a given message id (incremental polling). Returns the new max id to store for the next call.',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl: { type: 'string', description: 'Group URL or @username' },
                    sinceId:  { type: 'number', description: 'Return messages with id greater than this' },
                    limit:    { type: 'number', description: 'Max messages (default 100, max 200)' },
                },
                required: ['groupUrl', 'sinceId'],
            },
        },
        {
            name: 'get_message',
            description: 'Fetch a single message by id with full metadata (views, forwards, reactions, replies, media flag)',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl:  { type: 'string', description: 'Group URL or @username' },
                    messageId: { type: 'number', description: 'Message id' },
                },
                required: ['groupUrl', 'messageId'],
            },
        },
        {
            name: 'global_search',
            description: 'Search messages across ALL chats the account is in (not just one group)',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search keyword' },
                    limit: { type: 'number', description: 'Max results (default 30, max 100)' },
                },
                required: ['query'],
            },
        },
        {
            name: 'list_dialogs',
            description: 'List all chats/channels/groups the account is a member of, with unread counts',
            inputSchema: {
                type: 'object',
                properties: {
                    limit:    { type: 'number', description: 'Max dialogs (default 100, max 500)' },
                    archived: { type: 'boolean', description: 'Include archived dialogs' },
                },
            },
        },
        {
            name: 'list_folders',
            description: 'List the chat folders (dialog filters) configured on the account',
            inputSchema: { type: 'object', properties: {} },
        },
        {
            name: 'get_pinned',
            description: 'Get the pinned message(s) of a group/channel',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl: { type: 'string', description: 'Group URL or @username' },
                    limit:    { type: 'number', description: 'Max pinned messages (default 20)' },
                },
                required: ['groupUrl'],
            },
        },
        {
            name: 'get_media_info',
            description: 'Inspect a message\'s media (type, mime, size, duration, filename) WITHOUT downloading it',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl:  { type: 'string', description: 'Group URL or @username' },
                    messageId: { type: 'number', description: 'Message id' },
                },
                required: ['groupUrl', 'messageId'],
            },
        },
        {
            name: 'download_media',
            description: 'Download the media (video/photo/document/voice) of a message to disk — works for private groups the account is a member of. Returns the saved file path.',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl:  { type: 'string', description: 'Group URL or @username' },
                    messageId: { type: 'number', description: 'Message id' },
                    maxMB:     { type: 'number', description: 'Override the max download size in MB for this call (0 = no limit)' },
                },
                required: ['groupUrl', 'messageId'],
            },
        },
        {
            name: 'get_thumbnail',
            description: 'Download only the small preview image (thumbnail) of a message\'s media — a few KB instead of the full video/file. Returns the saved image path.',
            inputSchema: {
                type: 'object',
                properties: {
                    groupUrl:  { type: 'string', description: 'Group URL or @username' },
                    messageId: { type: 'number', description: 'Message id' },
                },
                required: ['groupUrl', 'messageId'],
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

                // getEntity() doesn't populate participantsCount/about — fetch the
                // full object so channels and basic groups report member counts.
                let members = entity.participantsCount ?? null;
                let about   = entity.about ?? null;
                try {
                    let full;
                    if (entity.className === 'Channel') {
                        full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
                    } else if (entity.className === 'Chat') {
                        full = await client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
                    }
                    if (full?.fullChat) {
                        members = full.fullChat.participantsCount ?? members;
                        about   = full.fullChat.about ?? about;
                    }
                } catch { /* keep entity-level fallbacks */ }

                const info = [
                    `Title: ${entity.title || entity.firstName || 'N/A'}`,
                    `ID: ${entity.id}`,
                    `Username: ${entity.username ? '@' + entity.username : 'N/A'}`,
                    `Members: ${members ?? 'N/A'}`,
                    `Type: ${entity.className}`,
                    about ? `About: ${about}` : null,
                ].filter(Boolean);
                return { content: [{ type: 'text', text: info.join('\n') }] };
            }

            case 'fetch_since': {
                const entity = await resolveGroup(args.groupUrl);
                const limit  = Math.min(args.limit ?? 100, 200);
                const msgs   = await client.getMessages(entity, { minId: args.sinceId, limit });
                if (!msgs.length) {
                    return { content: [{ type: 'text', text: `(no new messages since id ${args.sinceId})` }] };
                }
                const maxId  = Math.max(...msgs.map(m => m.id));
                const lines  = msgs.reverse().map(formatMsg);
                return { content: [{ type: 'text', text: `New messages (maxId=${maxId}):\n` + lines.join('\n') }] };
            }

            case 'get_message': {
                const entity = await resolveGroup(args.groupUrl);
                const [msg]  = await client.getMessages(entity, { ids: args.messageId });
                if (!msg) return { content: [{ type: 'text', text: `(message ${args.messageId} not found)` }] };
                const meta = msgMeta(msg);
                const text = [
                    formatMsg(msg),
                    `— views:${meta.views ?? 'N/A'} forwards:${meta.forwards ?? 'N/A'} reactions:${meta.reactions} replies:${meta.replies ?? 'N/A'} media:${meta.hasMedia} album:${meta.albumId ?? 'none'} reply:${meta.replyTo ?? 'none'}`,
                ].join('\n');
                return { content: [{ type: 'text', text }] };
            }

            case 'global_search': {
                const limit = Math.min(args.limit ?? 30, 100);
                const res = await client.invoke(new Api.messages.SearchGlobal({
                    q: args.query,
                    filter: new Api.InputMessagesFilterEmpty(),
                    minDate: 0, maxDate: 0,
                    offsetRate: 0,
                    offsetPeer: new Api.InputPeerEmpty(),
                    offsetId: 0,
                    limit,
                }));
                const names = {};
                for (const c of [...(res.chats || []), ...(res.users || [])]) {
                    names[String(c.id)] = c.title || c.username || c.firstName || String(c.id);
                }
                const lines = (res.messages || []).map(m => {
                    const where = names[peerKey(m.peerId)] || '?';
                    const date  = m.date ? new Date(m.date * 1000).toISOString().slice(0, 19).replace('T', ' ') : '';
                    return `[${date}] (${where}) ${m.message || '[media/no text]'}`;
                });
                return { content: [{ type: 'text', text: `Found ${lines.length} for "${args.query}":\n` + (lines.join('\n') || '(none)') }] };
            }

            case 'list_dialogs': {
                const limit   = Math.min(args.limit ?? 100, 500);
                const dialogs = await client.getDialogs({ limit, archived: !!args.archived });
                const lines = dialogs.map(d => {
                    const e   = d.entity || {};
                    const un  = e.username ? `@${e.username}` : '';
                    const unr = d.unreadCount ? ` (${d.unreadCount} unread)` : '';
                    // Print the marked id (-100… for channels) so it resolves directly.
                    const id  = e.id != null ? utils.getPeerId(e) : '?';
                    return `${e.className || '?'}: ${d.title || '(no title)'} ${un}${unr}  [id:${id}]`;
                });
                return { content: [{ type: 'text', text: `${lines.length} dialogs:\n` + lines.join('\n') }] };
            }

            case 'list_folders': {
                const r = await client.invoke(new Api.messages.GetDialogFilters());
                const filters = Array.isArray(r) ? r : (r.filters || []);
                const lines = filters
                    .filter(f => f.className !== 'DialogFilterDefault')
                    .map(f => {
                        const title = typeof f.title === 'string' ? f.title : (f.title?.text || '(unnamed)');
                        const count = (f.includePeers || []).length;
                        return `${title} — ${count} chats`;
                    });
                return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : '(no folders defined)' }] };
            }

            case 'get_pinned': {
                const entity = await resolveGroup(args.groupUrl);
                const limit  = Math.min(args.limit ?? 20, 50);
                const msgs   = await client.getMessages(entity, { filter: new Api.InputMessagesFilterPinned(), limit });
                const lines  = msgs.reverse().map(formatMsg);
                return { content: [{ type: 'text', text: lines.join('\n') || '(no pinned messages)' }] };
            }

            case 'get_media_info': {
                const entity = await resolveGroup(args.groupUrl);
                const [msg]  = await client.getMessages(entity, { ids: args.messageId });
                if (!msg) return { content: [{ type: 'text', text: `(message ${args.messageId} not found)` }] };
                const info = mediaInfo(msg);
                if (info.type === 'none') return { content: [{ type: 'text', text: '(message has no media)' }] };
                const sizeMB = info.sizeBytes != null ? (info.sizeBytes / 1024 / 1024).toFixed(2) : 'N/A';
                const text = [
                    `Type: ${info.type}`,
                    `Mime: ${info.mime || 'N/A'}`,
                    `Size: ${sizeMB} MB`,
                    info.duration != null ? `Duration: ${info.duration}s` : null,
                    info.fileName ? `File: ${info.fileName}` : null,
                ].filter(Boolean).join('\n');
                return { content: [{ type: 'text', text }] };
            }

            case 'download_media': {
                const entity = await resolveGroup(args.groupUrl);
                const [msg]  = await client.getMessages(entity, { ids: args.messageId });
                if (!msg)        return { content: [{ type: 'text', text: `(message ${args.messageId} not found)` }] };
                if (!msg.media)  return { content: [{ type: 'text', text: '(message has no media)' }] };

                const info  = mediaInfo(msg);
                const capMB = args.maxMB ?? MAX_DOWNLOAD_MB;
                // capMB === 0 means no limit (for deliberately large downloads).
                if (capMB > 0 && info.sizeBytes != null && info.sizeBytes > capMB * 1024 * 1024) {
                    const mb = (info.sizeBytes / 1024 / 1024).toFixed(1);
                    return { content: [{ type: 'text', text: `❌ File is ${mb} MB, over the ${capMB} MB limit. Pass a higher maxMB (or maxMB: 0 for no limit) to override.` }], isError: true };
                }

                const base = info.fileName ? safeName(info.fileName) : `${entity.id}_${args.messageId}${extFor(info)}`;
                const out  = path.join(DOWNLOAD_DIR, base);
                try {
                    await client.downloadMedia(msg, { outputFile: out });
                } catch (e) {
                    const m = /restrict|forbidden|noforward|protected/i.test(e.message)
                        ? 'This channel restricts saving content (no-forward).'
                        : e.message;
                    return { content: [{ type: 'text', text: `❌ Download failed: ${m}` }], isError: true };
                }
                const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
                return { content: [{ type: 'text', text: `💾 Saved: ${out}\nSize: ${(bytes / 1024 / 1024).toFixed(2)} MB` }] };
            }

            case 'get_thumbnail': {
                const entity = await resolveGroup(args.groupUrl);
                const [msg]  = await client.getMessages(entity, { ids: args.messageId });
                if (!msg)       return { content: [{ type: 'text', text: `(message ${args.messageId} not found)` }] };
                if (!msg.media) return { content: [{ type: 'text', text: '(message has no media)' }] };

                // Thumbnails live on the document (video/file) or as photo sizes.
                const doc    = msg.media.document;
                const thumbs = doc ? (doc.thumbs || []) : (msg.media.photo?.sizes || []);
                if (!thumbs.length) {
                    return { content: [{ type: 'text', text: '(no thumbnail available for this media)' }], isError: true };
                }
                // Pick the largest thumbnail by pixel area.
                let best = 0;
                for (let i = 1; i < thumbs.length; i++) {
                    const area  = (thumbs[i].w || 0) * (thumbs[i].h || 0);
                    const bestA = (thumbs[best].w || 0) * (thumbs[best].h || 0);
                    if (area > bestA) best = i;
                }
                const out = path.join(DOWNLOAD_DIR, `${entity.id}_${args.messageId}_thumb.jpg`);
                try {
                    await client.downloadMedia(msg, { thumb: best, outputFile: out });
                } catch (e) {
                    return { content: [{ type: 'text', text: `❌ Thumbnail download failed: ${e.message}` }], isError: true };
                }
                const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
                return { content: [{ type: 'text', text: `🖼️ Thumbnail saved: ${out}\nSize: ${(bytes / 1024).toFixed(0)} KB` }] };
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
