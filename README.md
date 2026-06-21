# telegram-mcp

Standalone MCP server that connects to Telegram **as the real user account** (MTProto
via [GramJS](https://github.com/gram-js/gram-js)) and exposes read-only group tools.
Used by Smart Volume Radar to mine stock-thesis channels (e.g. `@kikarhashuk`).

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `read_messages`   | `groupUrl`, `limit` | recent messages from a group/channel |
| `search_messages` | `groupUrl`, `query` | keyword search within a group/channel |
| `get_group_info`  | `groupUrl`          | group/channel metadata |

Internal MCP server name: `telegram-user`.

## Credentials (kept outside this repo)

`server.js` reads, from `$HOME`:

- `~/.telegram-mcp-config.json` — `{ "apiId": ..., "apiHash": "..." }`
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
