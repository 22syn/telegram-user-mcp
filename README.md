# telegram-mcp

Standalone MCP server that connects to Telegram **as the real user account** (MTProto
via [GramJS](https://github.com/gram-js/gram-js)) and exposes read-only group tools.
Used by Smart Volume Radar to mine stock-thesis channels (e.g. `@kikarhashuk`).

## Tools

All tools are **read-only**.

### Reading & search
| Tool | Args | Returns |
|------|------|---------|
| `read_messages`   | `groupUrl`, `limit` | recent messages from a group/channel |
| `search_messages` | `groupUrl`, `query`, `limit` | keyword search within a group/channel |
| `fetch_since`     | `groupUrl`, `sinceId`, `limit` | only messages newer than `sinceId` (incremental polling); returns the new max id |
| `get_message`     | `groupUrl`, `messageId` | one message + metadata (views/forwards/reactions/replies/media flag) |
| `global_search`   | `query`, `limit` | search across **all** chats the account is in |

### Discovery & navigation
| Tool | Args | Returns |
|------|------|---------|
| `get_group_info`  | `groupUrl`          | group/channel metadata (title, members, about) |
| `list_dialogs`    | `limit`, `archived` | all chats/channels the account is in, with unread counts |
| `list_folders`    | —                   | chat folders (dialog filters) on the account |
| `get_pinned`      | `groupUrl`, `limit` | pinned message(s) of a group/channel |

### Media
| Tool | Args | Returns |
|------|------|---------|
| `get_media_info`  | `groupUrl`, `messageId` | media type/mime/size/duration/filename **without** downloading |
| `download_media`  | `groupUrl`, `messageId`, `maxMB` | downloads video/photo/document/voice to disk (works for private groups); returns the saved file path |

Media downloads land in `~/.telegram-mcp-downloads/` (override with `downloadDir` in config).
`download_media` refuses files over `maxDownloadMB` (default 200) unless `maxMB` overrides it,
and reports a clear error for channels that restrict saving (`no-forward`).

Internal MCP server name: `telegram-user`.

## Credentials (kept outside this repo)

`server.js` reads, from `$HOME`:

- `~/.telegram-mcp-config.json` — `{ "apiId": ..., "apiHash": "..." }`
  (optional: `"downloadDir"`, `"maxDownloadMB"` — default `~/.telegram-mcp-downloads/`, `200`)
- `~/.telegram-mcp-session` — GramJS `StringSession` string

These are **never** committed (see `.gitignore`). To (re)generate the session:

```bash
npm run login   # runs auth.js — interactive MTProto login, writes ~/.telegram-mcp-session
```

## Run

```bash
npm install
npm start       # node server.js — speaks MCP over stdio
```

## Registered as an MCP server

Point an MCP client at the absolute path:

```json
{
  "mcpServers": {
    "telegram": {
      "command": "node",
      "args": ["/Users/kobihazout/telegram-mcp/server.js"]
    }
  }
}
```

The Smart Volume Radar project wires this in via its own `.mcp.json`.

## Not included here

The Radar's Telegram/Form-4 pipeline scripts (`daily-update.js`, `watchlist-health.js`,
`insider-fetch.js`, `weekly-insider-report.js`, …) used to live in this folder. They were
moved into the radar project at `smart-volume-radar/tools/tg-radar/` so this repo stays a
clean, reusable MCP server.
