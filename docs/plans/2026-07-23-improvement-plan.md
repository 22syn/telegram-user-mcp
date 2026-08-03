# Improvement plan — 2026-07-23

## Context
Read-only MCP server for Kobi's real Telegram account (MTProto/GramJS, not Bot API) — 13 tools shipped, matching Phase 0 of its own 3-phase PRD exactly. No relationship to smart-volume-radar's actual alert delivery (that uses a separate Bot API token) despite the PRD's stated original purpose of "mining tip channels for the radar" — that intent was never wired into radar's code. No relationship to hermes-agent either (different mechanism entirely — Bot API vs user-account MTProto).

## Tasks
- [ ] **Security gap worth flagging directly:** the PRD names a required prompt-injection safeguard (`wrapUntrusted()` — tagging chat content as untrusted before it reaches the model) as part of the design, but it's not implemented in `server.js`. Since this tool reads arbitrary Telegram content (including from channels/groups Kobi doesn't control) directly into a Claude session, this is a real gap, not a nice-to-have — **Verify:** untrusted-content wrapping implemented before any Phase 1/2 write capability is added
- [ ] Add FLOOD_WAIT / rate-limit handling — currently only GramJS's default 3 connection retries exist, nothing for Telegram's more aggressive throttling of user-account automation — **Verify:** a rate-limited call backs off gracefully instead of surfacing a raw GramJS error
- [ ] Decide whether to pursue Phase 1 (`notify_user`, `ask_user`, `send_file`) — not started, no urgency stated anywhere — **Verify:** decision recorded
- [ ] Phase 2 (write tools, `allowWrite` gate) — PRD's own open decision D1 is still unresolved ("build it but leave off until a decision is made") — **Verify:** decision made one way or the other, not left ambiguous indefinitely
- [ ] Reconcile the PRD's stated purpose ("mine tip channels for Smart Volume Radar") with the fact that no actual radar code uses this tool — either wire it in for real, or update the PRD to stop implying an integration that doesn't exist — **Verify:** PRD and reality match
