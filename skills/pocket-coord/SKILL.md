---
name: pocket-coord
description: Claim shared things in Pocket Code so two conversations don't work on them at once. Use before deploying, before working on a staging or production environment, or before any job on something another conversation could be using; when a command says a name is held; or when the user asks what is held or to wait for something.
---

# Pocket Code holds

A hold is a named claim such as `dad-staging`: one holder, a reason and an expiry. The user sees every hold in
Coordination. **A hold is advice.** It stops nothing, so a real deploy lock keeps applying and you keep obeying it. A hold
is still worth having because it covers the whole job (build, verify, wait for the user), where a lock covers only the
rollout step.

<!-- pocket:commands -->
Run `pocket-coord` from the Pocket Code directory (`node scripts/pocket-coord.mjs`, or
`npx pocket-coord`). The session instructions Pocket gives you name the exact command.
<!-- /pocket:commands -->
<!-- pocket:manual -->
How this feature works, how it is set up and its limits: `docs/manual/coordination.md` in the Pocket Code directory.
<!-- /pocket:manual -->

## Claim before you start

```text
pocket-coord hold <name> --reason "…" [--ttl 45m]
```

Claim the thing, not the task: `dad-staging`, not `paypal-fix`. Usual names are `dad-staging`, `dad-production`,
`tpv-deploy` and `pocket-main`. `pocket-coord list` shows them and what is held now.

- Write the reason for someone who finds it later: `Building and verifying 1.168`.
- A hold lasts 60 minutes unless `--ttl` says otherwise, 8 hours at most. It renews while this conversation is running.
- Holding the same name again renews it.
- A name close to an existing one is refused, so `staging` and `dad-staging` don't become two holds. Use the existing name.
  Pass `--new` only if it really is a different thing.

## If it is held

The command exits 2 and names the holder, the reason and how long. **Stop.** Don't work around it. Then either tell the user
what is in the way, or wait:

```text
pocket-coord wait <name>
```

Pocket wakes this conversation once with a labeled message when the name is free, in the same approval mode. End your reply
after asking; don't sit in a loop. The message doesn't claim anything for you, so claim the name before you go on: someone
else may have got there first. From a terminal, use `pocket-coord wait <name> --block [--timeout 30m]`, which waits in the
shell and exits 3 on a timeout.

## Let go when the job is done

```text
pocket-coord release <name> [--note "…"]
```

Release when the job is finished, not when your reply ends. A job that waits for the user to check something keeps its hold.
The note is for whoever comes next.

## If you are told a hold ended

The user can release any hold, and an idle hold expires. Your next message then ends with a line from Pocket saying so. Treat
that as a stop: run `pocket-coord list`, and claim the name again before you carry on with that work.

## Who you are

Pocket proves which conversation is asking from its own token, not from anything you say. A conversation it can't prove shows
as `Terminal session`, unverified. Such a session can release only a hold no conversation proved, and can't be woken.
