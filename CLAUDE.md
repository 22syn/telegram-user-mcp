# CLAUDE.md — telegram-mcp

**Purpose**
An MCP (Model Context Protocol) server that connects to Telegram **as a real user account** (MTProto via GramJS), exposing read-only tools to MCP clients (Claude Desktop, Cursor, etc.): read & search messages, list chats/folders, inspect group info, get pinned messages, and download media. Because it authenticates as the user, it can see everything the account can — private channels, groups, and DMs a bot cannot.

**Stack**
- Node.js ≥18, CommonJS (plain JS, no build step)
- `@modelcontextprotocol/sdk` — MCP server framework
- `telegram` (GramJS) — MTProto client
- `input` — interactive CLI prompts during setup

**Structure**
- `server.js` — the MCP server; implements all tools (main entry, `main` field)
- `setup.js` — one-time interactive login (`api_id`, `api_hash`, phone, 2FA)
- `cli.js` — `bin` entry (`telegram-user-mcp`), dispatches setup vs. server
- `docs/` — additional documentation
- `LICENSE` (MIT), `README.md`

**Run / dev**
- `npm run setup` (or `npx telegram-user-mcp setup`) — one-time login
- `npm start` — run the MCP server (`node server.js`)
- Register in an MCP client via `command: npx`, `args: ["-y", "telegram-user-mcp"]`

**Conventions / notes**
- All tools are **read-only** (reading, search, discovery, media info/download). No sending/posting.
- `groupUrl` args accept a `https://t.me/...` link, `@username`, or numeric id (from `list_dialogs`).
- Config in `~/.telegram-mcp-config.json` (`apiId`, `apiHash`, `phoneNumber`, optional `downloadDir`, `maxDownloadMB`). Login session in `~/.telegram-mcp-session` — grants full account access; treat as a password, never commit/share. Media downloads land in `~/.telegram-mcp-downloads/`.
- `download_media` refuses files over `maxDownloadMB` (default 200) unless `maxMB` overrides; use `get_thumbnail` to preview heavy videos cheaply.
- Get `api_id` / `api_hash` from https://my.telegram.org → API development tools.
