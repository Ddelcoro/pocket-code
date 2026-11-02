# Context and worker policy: spec

Status: phase 1 is in this release. Phases 2 and 3 are proposed.

## Why

Long conversations are what cost the most, not the model's own writing. A four-week measurement on one heavy
install (Oct 5 to Nov 2, 2026; 791 conversations, about 95,000 model requests, weighted at API list prices)
found:

- 44% of the cost was re-reading cached context, 34% was writing context to the cache, and 22% was output.
- 65% of the cost came from requests made when the conversation was over 200K tokens, and 30% when it was over 400K.
  Conversations that ever grew past 300K tokens made up 81% of the cost.
- Re-caching a long conversation after it sat idle (a write of 100K tokens or more) was 11%.
- Subagents were 23%, almost all of them running on the same model as the conversation that started them.

Both agents Pocket runs can compact a conversation and choose a cheaper model for their subagents. But
each agent reads those choices from its own configuration, so before this feature they could only be set
server-wide, in each agent's own config files.
Pocket starts every agent process, so it is the one place one policy can reach all of them.

## Terms

- **Context limit:** the size in tokens a conversation should stay under. The agent compacts (summarizes the
  older part of the conversation) shortly before reaching it.
- **Leader:** the model running the conversation. **Worker:** the model its subagents run on when the leader
  does not choose one for a particular subagent.
- **One tier down:** the worker is the next cheaper model of the same maker: Fable (or Mythos) → Opus, Opus → Sonnet,
  GPT Astra → GPT Sol. Sonnet, Haiku and the other Codex models stay on the agent's default.
  A leader can still name a model for a particular subagent; that choice wins.

## Settings (phase 1)

Settings → Agents & instance → **Context and subagents**. Server-wide, saved in `pocket-settings.json` as
`contextPolicy`:

```json
{ "compaction": { "mode": "agent" | "limit", "limit": 200000 },
  "workers": { "model": "default" | "tier-down", "effort": null | "low" | "medium" | "high" } }
```

The defaults are `agent`, `default` and `null`, which change nothing. So an existing install behaves exactly
as before until its owner chooses otherwise. `limit` is 50,000 to 1,000,000 tokens, and the Settings choices are
150K, 200K, 300K, 400K and 600K. `POST /api/settings` accepts `contextPolicy` (or `null` to clear it) and
rejects anything else with a 400.

## How each agent gets it

| Engine | Context limit | Worker model and effort | Verified |
|---|---|---|---|
| Claude Code | `--settings {"env":{"CLAUDE_CODE_AUTO_COMPACT_WINDOW": limit}}`. The CLI clamps it to the model's window and compacts about 33K tokens before it. | `CLAUDE_CODE_SUBAGENT_MODEL` (alias `opus` / `sonnet`, so it follows the newest version) and `CLAUDE_CODE_SUBAGENT_EFFORT` in the same `--settings` `env`. This outranks `~/.claude/settings.json` `env`. | 2.1.316: `/context` showed a 150K window instead of 1M. A subagent launched without a model ran Sonnet 5.5 at low effort while `~/.claude/settings.json` said `opus`. |
| Codex | `config.model_auto_compact_token_limit` on `thread/start`, `thread/resume` and `thread/fork`, set to 85% of the limit (Claude's margin at 200K). | `config["agents.default_subagent_model"]` (the newest GPT Sol that Codex lists) and `config["agents.default_subagent_reasoning_effort"]`. | 0.166.0: a sub-agent spawned without a model or effort ran `gpt-6.1-sol` at `low`. |
| OpenRouter (OpenCode) | Not in phase 1. OpenCode's `compaction` has `auto`, `prune` and `reserved` but no token limit. | Not in phase 1. | — |

The leader is the model the conversation is started with. If that model is Default, the leader is Pocket's
default model or the CLI's own (`~/.claude/settings.json` `model`, or the Codex default). The policy
applies when an agent process starts. A process that is already running picks a changed policy up at its
next reply, unless it is running a background job; such a process keeps the old policy until it is replaced.
The engine registry lists `contextPolicy` per engine, so the setting says which agents it applies to.

## Phase 2 (proposed): Pocket-run compaction and hand-off

New `compaction.mode` values, carried out by Pocket between replies, never during one and never while
background jobs run:

- `warn`: the context meter turns amber at 80% of the limit, and a note offers the choices below.
- `compact`: at the limit, Pocket runs `/compact <instructions>` (Claude) or `thread/compact/start` (Codex),
  using the owner's compaction instructions (`compaction.instructions`, for example "keep file paths,
  decisions, open bugs and the current step").
- `handoff`: at the limit, Pocket asks the agent for a handoff summary, then starts a new conversation from it,
  linked to the old one the way Branch links them. Each new conversation starts small, which suits builds
  that run for days.
- `compaction.idleResume`: when a conversation over a set size is reopened after the cache has expired
  (about an hour idle), start it from a summary instead of re-caching the whole history.
- Overrides per project and per conversation, on top of the server-wide policy.
- OpenRouter: hand-off and warn need nothing from the agent, so they work there too. Its token limit can be set
  through `compaction.reserved` = the model's window − the limit, when the catalog gives the window.

## Phase 3 (proposed): usage

A Usage page showing weekly cost by conversation, model, subagent share and context size, built from the
transcripts the way the measurement above was. It shows whether a policy change worked.

## Risks

- Compaction drops detail, and a hard build can lose its thread when it happens mid-task. That is why the limit
  is the owner's choice and why phase 2 adds instruction-led compaction and hand-off.
- A cheaper worker model makes some subagent work worse. The leader can still name a model for a particular
  subagent, and the setting can be switched back.
- The agents' own setting names can change. The verification in the table above is repeated before each release
  that touches this feature.
