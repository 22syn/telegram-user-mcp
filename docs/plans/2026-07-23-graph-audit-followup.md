> NEXT SESSION: review this plan before making structural changes to this repo, and report status to Kobi.

# Graph-Audit Follow-up — telegram-mcp (2026-07-23)

## Graph snapshot

- **Code symbols:** 32 (small, single-purpose MCP server; plain CommonJS, no build step).
- **Top hubs (degree):**
  - `server.js` — 21 (the MCP server; implements every tool)
  - `setup.js` — 10 (one-time interactive login)
  - `mediaInfo()` — 3 (in `server.js`)
  - `{ TelegramClient }` — 3 (GramJS import, in `setup.js`)
  - `main()` — 3 (in `setup.js`)
- **Import cycles:** none.
- **Zero-edge nodes:** 1 — a config/entry/test island (e.g. `cli.js` bin dispatcher or a standalone entry), **not** removable dead code; leave it in place.
- **Age:** 19 days since last significant change.

## Change-risk hotspots

- **`server.js` (deg 21)** — the whole tool surface lives in one file. Every tool (`read_messages`, `search_messages`, `global_search`, `download_media`, etc.) is defined here, so any edit has repo-wide blast radius. Test tool-by-tool after changes.
- **`setup.js` (deg 10)** — the interactive login that writes `~/.telegram-mcp-config.json` and the session string. Errors here break authentication for the whole server.

## Security note (read-only surface + session secret)

- All exposed tools are **read-only** (read/search/list/inspect/media) — no send/post/delete. Preserve this invariant: any new tool that mutates Telegram state would change the repo's security posture and must be a deliberate, reviewed decision, not an incidental addition.
- Login creates a session string in `~/.telegram-mcp-session` that grants **full account access** — treat as a password. It must never be committed, logged, or moved into a hosted context. Guard this in any refactor of `setup.js` or session handling.

## Action items

**No structural action required — maintenance / watch-list only.**

- Clean graph: no cycles; the single zero-edge node is an entry/config island, not dead code — do not remove it.
- The concentration in `server.js` is normal for a small MCP server and does not justify splitting today; revisit only if the tool count grows substantially.
- Watch items are the two invariants above (read-only tool surface, session-secret handling), not graph structure.
