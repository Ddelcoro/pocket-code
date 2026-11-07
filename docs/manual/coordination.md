<!-- manual
checked: 1.99.0
sources: coordination.mjs, public/coordination.js, scripts/pocket-coord.mjs, skills/pocket-coord/SKILL.md
-->
# Coordination

Coordination shows which conversation holds a shared thing such as staging or a deploy, who is waiting for it, and what ended lately. Agents make the claims. You read the list and can release anything on it.

A hold is a named claim such as `dad-staging`: one holder, a reason and an expiry. **A hold is advice.** Agents check it because their instructions tell them to, and nothing in Pocket stops a deploy. If you have a real deploy lock, keep it. A hold is still useful because it covers the whole job (build, verify, wait for you), where a lock usually covers only the rollout step.

## Turn it on

Coordination is off until you switch it on for the whole instance:

1. Open **Settings → Projects, files, tasks & vault**.
2. Turn on **Coordination**.

While it is on, Pocket installs the `pocket-coord` skill for Claude Code and Codex and tells the agents it runs to claim a shared thing before they start. Turning it off hides the view and removes the skill. Holds already made stay in the store, and nothing expires or wakes until it is back on.

Assistant mode has no Coordination: the switch, the view and the line above the conversation list are all hidden, and `pocket-coord` answers that it is off.

## Use it

### See what is held

- While something is held, one line shows above the conversation list: `dad-staging held by "DAD 1.168 build"`, with `and 2 more` when there are others. It opens the view. Nothing shows when nothing is held.
- The **Coordination** chip sits beside Files, Tasks and Projects on the home screen and on **Your conversations**.
- On a computer you can also pick it from the split view chooser beside a conversation.
- The full view is at `#/coordination`. It opens like a conversation: as a tab, beside a conversation, in a window of its own, or full screen on a phone.

**Held now** has one row per hold: the name, the conversation holding it (a link), the reason, how long it has been held, and who is waiting, in the order they asked. A holder Pocket can't prove reads `Terminal session`.

**Recent** lists holds that ended in the last 7 days, up to 30: **Released** with the holder's note, **Expired**, or **Released by you**.

### Release a hold

**Release** is one tap, with no confirmation. The holder isn't stopped: it is told when it next runs, in a line Pocket adds to its next message. If a conversation asked to wait, Pocket wakes the first one in line.

Release a hold you know is stale. If an agent is still working on the thing, tell that conversation first, because releasing doesn't undo what it is doing.

### What happens when two conversations want the same thing

The second agent gets an error that names the holder, the reason and how long it has been held. It stops and either tells you or asks to wait.

A conversation that asked to wait is woken once, with a labeled message, when the name is free, in the approval mode it asked with. The message goes through the conversation's own queue, so paused messages stay paused and first. Being woken doesn't claim the name: the agent claims it again before it carries on. A conversation is woken only if it asked.

### Expiry

A hold lasts 60 minutes unless the agent sets a time, 8 hours at most. It renews while its conversation is running. When it runs out it moves to **Recent** as **Expired**, and the holder is told when it next runs.

## For agents

```text
pocket-coord hold <name> --reason "…" [--ttl 45m] [--new]
pocket-coord wait <name> [--block --timeout 30m]
pocket-coord release <name> [--note "…"]
pocket-coord list [--json]
```

| Exit code | Meaning |
|---|---|
| 0 | Done |
| 1 | Anything else, such as a hold that isn't yours to release. The message says why |
| 2 | Held by someone else, or a name close to an existing one |
| 3 | `wait --block` timed out |
| 4 | The command couldn't sign in to Pocket |
| 5 | Coordination is off |

- **Names** are lowercase letters, numbers, dots, dashes and underscores, up to 64 characters. The usual ones are `dad-staging`, `dad-production`, `tpv-deploy` and `pocket-main`. `pocket-coord list` shows them, and names used lately. A name close to an existing one is refused unless the agent passes `--new`, so `staging` and `dad-staging` don't become two holds.
- **Holding again** renews a hold you already have.
- **A terminal session** can hold, and shows as `Terminal session`, unverified. It can't be woken, so it waits with `--block`, in its own shell. It can't release a conversation's hold, and any session can release a terminal session's hold.

The `pocket-coord` skill tells agents all of this. See [For agents](for-agents.md).

## Reference

- **Identity.** Pocket proves a conversation from its own runner token, never from what an agent says. This works on Claude Code, Codex and OpenRouter. For OpenRouter the proof applies to Coordination only: the Vault still treats those conversations as terminal sessions.
- **Data.** Holds live in `coordination.json` in `POCKET_DATA_DIR`. Pocket writes it atomically and keeps it in memory, so edit it only with Pocket stopped. Older versions ignore the file.
- **One writer.** The view and `pocket-coord` both go through the server.
- **Sweep.** Every 30 seconds Pocket renews the holds of running conversations, expires the rest and wakes whoever is next.
- **Refreshing.** The open view checks every 10 seconds while its window is visible.

### Limits

| Limit | Value |
|---|---|
| Default hold | 60 minutes |
| Shortest and longest hold | 1 minute, 8 hours |
| Reason | 200 characters |
| Note | 300 characters |
| Waiters on one name | 20 |
| Recent | 30 holds, 7 days |

### Settings and environment

| Setting or variable | Effect |
|---|---|
| **Settings → Projects, files, tasks & vault → Coordination** | Turns Coordination on for the instance (`coordination` in `pocket-settings.json`). |
| `POCKET_COORD_SWEEP_MS` | How often Pocket renews, expires and wakes, in milliseconds. Default 30000. |
| `POCKET_SKILLS=0` | Pocket doesn't install the `pocket-coord` skill. |

## Troubleshooting

**An agent went ahead while something was held.** Holds are advice, and nothing enforces them. Keep a real lock on anything that must not run twice.

**A conversation shows as `Terminal session`.** Pocket couldn't prove who was asking. That is normal for a session started outside Pocket. The hold still counts.

**A waiting conversation didn't wake.** It is woken only if it asked with `pocket-coord wait`, and a paused queue stays paused. Check **Held now** for who is first in line.

**`pocket-coord` says Coordination is off.** Turn it on in **Settings → Projects, files, tasks & vault**. In Assistant mode it stays off.
