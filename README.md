# telegram-user-mcp

An [MCP](https://modelcontextprotocol.io) server that connects to Telegram **as your
real user account** (MTProto via [GramJS](https://github.com/gram-js/gram-js)) and
exposes read-only tools — read & search messages, list your chats/folders, inspect
group info, and download media — to any MCP client (Claude Desktop, Cursor, etc.).

Because it logs in as **you**, it can see everything your account can: private
channels and groups you're a member of, DMs, and their media. A bot cannot do this —
that's the whole point of this server.

> ⚠️ **Security:** logging in creates a session string in `~/.telegram-mcp-session`.
> That string grants **full access to your Telegram account** — treat it like a
> password. Never share it, never commit it, never paste it into a hosted service.
> This server keeps it on your machine and only ever reads.

## Quick start

You need [Node.js](https://nodejs.org) ≥ 18.

### 1. Get Telegram API credentials

Go to <https://my.telegram.org> → **API development tools** → create an app, and copy
your `api_id` and `api_hash`. (These identify the app, not your account.)

### 2. Run setup (one time)

```bash
npx telegram-user-mcp setup
```

It asks for your `api_id`, `api_hash`, and phone number, then logs you in (you'll get
a login code in the Telegram app; enter it, plus your 2FA password if you have one).
This writes:

- `~/.telegram-mcp-config.json` — `{ apiId, apiHash, phoneNumber }`
- `~/.telegram-mcp-session` — your login session (keep secret)

### 3. Register it in your MCP client

**Claude Desktop** (`claude_desktop_config.json`) or **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "telegram-user-mcp"]
    }
  }
}
```

Restart the client. The Telegram tools will appear.

## Tools (all read-only)

### Reading & search
| Tool | Args | Returns |
|------|------|---------|
| `read_messages`   | `groupUrl`, `limit` | recent messages (with id, media tag + album id) |
| `search_messages` | `groupUrl`, `query`, `limit` | keyword search within a chat |
| `fetch_since`     | `groupUrl`, `sinceId`, `limit` | only messages newer than `sinceId`; returns the new max id |
| `get_message`     | `groupUrl`, `messageId` | one message + metadata (views/forwards/reactions/replies/media flag) |
| `global_search`   | `query`, `limit` | search across **all** chats you're in |

### Discovery & navigation
| Tool | Args | Returns |
|------|------|---------|
| `get_group_info`  | `groupUrl`          | group/channel metadata (title, members, about) |
| `list_dialogs`    | `limit`, `archived` | all chats/channels you're in, with unread counts |
| `list_folders`    | —                   | chat folders (dialog filters) |
| `get_pinned`      | `groupUrl`, `limit` | pinned message(s) |

### Media
| Tool | Args | Returns |
|------|------|---------|
| `get_media_info`  | `groupUrl`, `messageId` | media type/mime/size/duration/filename **without** downloading |
| `get_thumbnail`   | `groupUrl`, `messageId` | downloads just the small preview image (a few KB) instead of the full video/file |
| `download_media`  | `groupUrl`, `messageId`, `maxMB` | downloads video/photo/document/voice to disk; returns the saved path |

`groupUrl` accepts a `https://t.me/...` link, an `@username`, or a numeric id (as
printed by `list_dialogs`). Media downloads land in `~/.telegram-mcp-downloads/`.
`download_media` refuses files over `maxDownloadMB` (default 200) unless `maxMB`
overrides it (`maxMB: 0` = no limit), and reports a clear error for channels that
restrict saving (no-forward). For heavy videos you only want to preview, use
`get_thumbnail` — a 1 GB video has an ~18 KB thumbnail.


### Album grouping

A Telegram album — one caption plus N photos — arrives as N separate messages. They are tied
together only by `groupedId`, which `read_messages` now appends as `[album:<id>]` and
`get_message` reports as `album:<id>`. Without it a consumer cannot tell that a caption belongs
to the images posted beside it, and the evidence gets severed from the claim.

**The id is a string, deliberately.** These values routinely exceed `Number.MAX_SAFE_INTEGER`,
so putting them through a numeric coercion is lossy: `14285256815022453` collapses to
`...452`, which is a *different album's* id. Two unrelated posts would merge. Keep it a string
end to end.

Messages that are not part of an album carry no tag (`album:none` in `get_message`).

### Replies

`read_messages` also appends `[reply:<id>]` when a message replies to another, and
`get_message` reports `reply:<id>`. This is the only **explicit** link Telegram offers between
two separate messages, which matters when a caption and its media were posted as two messages
rather than as an album: on one tracked channel that is 18.8% of all messages.

Timing is not a substitute. A text-only message followed a second later by a media-only message
is indistinguishable from two unrelated posts — measured on a channel that fires bursts of
separate forwarded items inside one second. Use `reply:`; do not infer from timestamps.

## Configuration

`~/.telegram-mcp-config.json`:

```json
{
  "apiId": 123456,
  "apiHash": "your_api_hash",
  "phoneNumber": "+9725...",
  "downloadDir": "~/.telegram-mcp-downloads",
  "maxDownloadMB": 200
}
```

`downloadDir` and `maxDownloadMB` are optional.

## Run from source

```bash
git clone https://github.com/KobiHaz/telegram-user-mcp.git
cd telegram-user-mcp
npm install
npm run setup
npm start
```

## License

MIT © Kobi Hazout
