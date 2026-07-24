# Hermes Agent Send-Message Tool — Design

**Status:** Approved (2026-07-24)
**Related:** [docs/plans/2026-07-23-graph-audit-followup.md](../../plans/2026-07-23-graph-audit-followup.md)

## Context

`telegram-mcp` connects as Kobi's real Telegram user account (MTProto/GramJS) and today exposes only read-only tools (read/search/list/inspect/media). The 2026-07-23 graph-audit plan explicitly flags this as an invariant: any tool that mutates Telegram state is "a deliberate, reviewed decision, not an incidental addition."

Kobi runs a separate service, **Hermes Agent** (configured elsewhere), with a Telegram bot front-end — `@xsheva_bot`, shown in his dialogs as "AIAssistance". He wants to message it and read its replies from Claude, through this MCP server.

## Goal

Add exactly one new tool that can send a plain-text message to Hermes Agent's bot chat, and nothing else. Explicitly not a general send-message capability — scoped to this one chat only, per Kobi's direction ("only for hermes agent").

## Non-goals

- No generic `send_message(groupUrl, text)` callable against arbitrary chats.
- No message editing or deletion.
- No media/attachment sending.
- No built-in "wait for reply" behavior — reading replies uses the existing `read_messages` / `fetch_since` / `get_message` tools.

## Design

### Config

Add one field to `~/.telegram-mcp-config.json`:

```json
{
  "hermesBot": "@xsheva_bot"
}
```

Accepts the same formats `resolveGroup()` already supports (`@username`, `t.me/...` link, or numeric id). Read once at startup alongside `apiId`/`apiHash`.

### New tool: `send_hermes_message`

- **Input schema:** `{ text: string }` — `text` required. No chat/target parameter — the destination is fixed by config, not caller-supplied.
- **Behavior:**
  1. If `cfg.hermesBot` is unset, return `{ isError: true }` with a message telling the user to add the config field. No fallback or guessing at a target.
  2. Resolve the target via the existing `resolveGroup()` helper.
  3. Send via GramJS `client.sendMessage(entity, { message: args.text })`.
  4. On success, return a confirmation: message id + timestamp (same date formatting style as `formatMsg`).
  5. On failure, wrap in try/catch and return `{ isError: true }` with the underlying error message — same pattern as every other tool in `server.js`.

### Data flow

```
Claude → send_hermes_message({text}) → resolveGroup(cfg.hermesBot) → client.sendMessage() → Telegram → Hermes Agent bot
                                                                                                        ↓ (replies in same chat)
Claude → read_messages / fetch_since (existing tools) ← Telegram ← Hermes Agent
```

Send and read stay two separate tool calls. No polling loop inside `send_hermes_message` — keeps the call fast and bounded regardless of how long Hermes takes to respond.

### Security posture

This is the first tool in the repo that mutates Telegram state. Blast radius is deliberately narrowed:

- Destination is fixed via server-side config, not a caller-supplied parameter — a bad argument can't redirect the send to a different chat.
- Payload is plain text only.
- Every other chat in the account remains exactly as read-only as before this change.

This satisfies the graph-audit plan's invariant: a scoped, reviewed addition, not a general capability.

### Testing

- Call `send_hermes_message` against this branch with a test string; confirm delivery in the Telegram app or via `read_messages` on the same chat.
- Confirm the error path when `hermesBot` is missing from config.
- Confirm a GramJS-level send failure (e.g., blocked/deleted chat) surfaces as `isError: true` rather than throwing.

### Rollout

Implemented on the current worktree branch. After merge, Kobi's MCP client needs to load the updated server — either by updating/reinstalling the `telegram-user-mcp` package it runs via `npx`, or by pointing the client config at this checkout directly for testing. Exact mechanism depends on how the client is currently configured; confirm during implementation.
