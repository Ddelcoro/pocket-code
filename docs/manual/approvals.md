<!-- manual
checked: 1.103.0
sources: approvals.mjs, trusted.mjs, questions.mjs, subagents.mjs, public/approvals.js, public/workspace.js
-->
# Questions and approvals

While an agent works it can stop and wait for you in two ways: it asks a question, or it asks permission to run an action.
Pocket Code shows both in the conversation, sends a notification, and passes your answer back to Claude Code or Codex. The
permission mode you pick for each reply decides how often the agent has to ask. There is nothing to turn on.

## Use it

### Answer a question

When Claude uses its question tool (AskUserQuestion), or Codex asks a native question, the conversation shows a banner
such as **Claude has a question for you** or **Codex has 2 questions for you**, and the conversation list marks the
conversation **Needs your answer**.

When it is one question with up to four options (and not a multiple-choice or secret one), the banner asks it
directly: the question is the title and each option is a button. Tap one and the answer is sent. **Answer** opens the
form instead, for a typed answer or to read the options' descriptions.

Otherwise:

1. Choose **Answer** (or **Answer all**) on the banner. The **Agent questions** sheet opens.
2. For each question, pick an option (several when the question allows more than one), or type under **Or write an
   answer**. A typed answer replaces the options you ticked.
3. Choose **Send answers**. Every question needs an answer before it sends. The sheet closes itself once no question
   is left waiting.

A question from a subagent says so under the question: **From subagent: Review imports** (the name the agent was
started with).

A question Codex marks as secret takes its answer in a password field. Codex shows native questions mostly in **Plan
first** mode (the Codex mode chip above the message box). A non-blocking Codex question says "Codex keeps working while it
waits"; a blocking one says "The reply is paused until you answer."

Questions the agent asks in its final reply, with suggested buttons, are a different thing: see
[suggested replies](conversation.md#pick-a-suggested-reply).

### Type instead of answering

You do not have to use the form. While a blocking question waits, the message box reads **Answer above, or type here to
skip the questions…**. A message sent with **Steer now** goes to the running reply, and every waiting blocking question is
answered "skipped": the agent reads your message instead and may ask again later. The delivery note says **Questions
skipped. Your message went to the running reply.** A message sent with **After this reply** is queued and leaves the
question waiting.

### Choose Review actions or Full access

Each reply runs in one of two permission modes:

- **Review actions**: the agent asks before running commands, editing files, starting subagents or using external tools,
  and Pocket shows each request as an approval card. Ordinary file reads run without asking. Codex runs in a read-only
  sandbox and asks for anything outside it; safe reads and actions its own configuration already allows run without
  asking.
- **Full access**: the agent runs its tools without routine prompts, with the full access of the server account Pocket runs
  as.

Pick the mode for the next reply with the permissions chip above the message box (**Review actions** or **Full access**;
**Review** or **Full** on a narrow screen), or **Conversation options → Permissions for the next reply**. The sheet is
titled **Permissions for the next reply**. The New conversation screen has the same chip.

How the choice applies:

- It applies to the next reply that starts. A reply already running keeps the mode it started with; steering it does not
  change its permissions.
- A message queued with **After this reply** captures the mode selected when you queued it. The Queue panel shows it on
  each row.
- A Branch uses the conversation's next-reply mode.
- When a conversation's process is kept between replies, changing the mode restarts that process for the next reply.
- The choice is remembered per conversation on this browser. A conversation you never set uses the install default.

The install default is **Review actions**. The operator can change it, or remove Full access entirely, with environment
variables (see [Settings](#settings)). When Full access is turned off, the chip offers only Review actions and the server
refuses any request for Full access.

In Assistant mode the permissions chip is hidden; replies use the conversation's remembered mode or the install default.

### Review an action

In Review actions, when the agent asks to run something, the Working row reads **Waiting for your OK** and the
conversation list shows **Needs approval**.

When one request waits, the banner under the conversation header is the card: it asks in plain words what the agent
wants to do ("Run: Run the import checks?", "Save report.csv?"), shows the command or the file under it, names the
subagent when one asked (**From subagent: Review imports**), and carries **Don't allow** and **Allow**. One tap decides
it. **Details** opens the sheet with the full request. A request Pocket cannot show in full offers only **Don't allow**
and **Details**.

When several requests wait, the banner reads **N requests waiting for your OK** with **Review**:

1. Choose **Review**. The **Waiting for your OK** sheet lists each pending request as a card.
2. Each card asks in plain words what the agent wants to do ("Run this command?", "Apply these file changes?") and shows
   the command, or the files it would change. **Show details** has the full request.
3. Choose **Allow** or **Don't allow**. The sheet closes itself once nothing is left waiting; with more requests left,
   it shows them.

The allow button names its scope:

| Button | Covers |
|---|---|
| **Allow** | This one command, file change or tool call. |
| **Allow network access** | A Codex network request. It can release several pending requests to the destination shown. |
| **Allow for this reply** | A Codex request for more access. It grants the listed access until the reply ends. |

For the two broader grants the card states the scope above the details. After **Allow**, the card says "Allow decision
sent. Check the conversation for the result": an approval is not proof the action succeeded. After **Don't allow**, the
agent may try a different approach; Claude is also told not to run the denied action through another tool.

A card can also say "A complete, supported action preview is unavailable". Pocket never approves an action it cannot show
in full, so only **Don't allow** works there; ask the agent for a different action. **Refresh** reloads the live requests.

Closing the sheet, locking the phone or losing the connection never approves anything. The request keeps waiting.

### Let read-only actions run without asking

Under Review actions every Bash command, MCP tool call and web lookup shows a card, including harmless reads. The owner can
list read-only actions that Claude may run without a card in **Settings → Agents & instance → Actions that run without
asking**:

1. Type a rule under **Add an action**, for example `Bash(git status)`, `Bash(acme-report:*)` or `mcp__memory__*`.
2. Choose **Add**. A rule Pocket will not accept is refused with the reason under the field.
3. **Remove** takes a rule off. **Use the server's list** goes back to the list in `POCKET_TRUSTED_ACTIONS`.

This covers Claude replies in Review actions only. Codex and Full access are not affected. A listed command runs with any
arguments the agent gives it, so list only commands that cannot change anything. The rule syntax, what counts as a match
and the audit record are in [Action approvals](../action-approvals.md#actions-that-run-without-asking).

### Get notified on your phone

A new question or approval sends a push notification to every device with **Settings → Notifications & voice → Push to
this device** and **Finished replies** on: **Claude has a question** or **Codex has a question** ("Open Pocket Code to
answer it."), or **Waiting for your OK** ("Open Pocket Code to review the pending action."); from a subagent, **A
subagent has a question** or **A subagent is waiting for your OK**. The notification carries no command or argument details. Tapping it
opens the conversation; answer or approve there. Action approvals cannot be answered from the notification itself.
(Vault requests are different: those notifications carry Allow and Deny buttons; see
[Vault](vault.md#answer-a-request).)

A conversation muted with its **Alerts** chip sends no notifications, including questions and approvals.

Until you answer them, waiting questions and approvals also show under the conversation list's **Attention** filter (see
[Find a conversation](sessions.md#find-a-conversation)) and, in Assistant mode, as **Waiting for you** cards on the home
screen.

## How it works

### What happens if you don't answer

Nothing is decided for you. The reply waits until you answer:

- Questions and approvals do not expire, and a reply waiting on one is never stopped for being quiet (the stall watchdog
  skips it).
- **Stop** ends the reply and withdraws its questions and cards.
- A request from a subagent outlives the reply that started it. When a reply ends while a background subagent's request
  is still waiting, or a background subagent asks after the reply has ended, Pocket opens a stand-in turn for it: the
  conversation reads **Needs approval** or **Needs your answer** and the card is shown as usual, named after the agent.
  The stand-in ends the moment nothing is waiting and the conversation goes back to **Working in background**; it records
  no reply of its own. A message you type meanwhile goes to the agent and does not skip a subagent's question.
- If Pocket restarts while a request waits, the request cannot be answered any more. The restarted server reattaches to
  the agent process and answers each request sent before the restart with a deny (Codex: the matching decline), so the
  reply carries on and the agent can ask again. If Pocket cannot reach the process's input any more, the conversation
  shows **Approval connection interrupted** or **Question interrupted**; use **Stop interrupted reply**, review what finished, and send a new
  message.

### Provider details

| | Claude Code | Codex |
|---|---|---|
| Review actions | Permission mode `default`, with ask rules for Bash, PowerShell, Edit, Write, NotebookEdit, Agent, Task, WebFetch, WebSearch and every MCP tool. | Read-only sandbox, `untrusted` approval policy, the user as reviewer. |
| Full access | `bypassPermissions` | `danger-full-access` sandbox, approval policy `never` |
| Request kinds | One kind: a tool call, shown in plain words. | Command, file change, network access, additional permissions. |
| From subagents | Shown with the agent's name, read from the agent's own transcript (`<project>/<session>/subagents/`). | Re-homed on the reply with the agent's name; a subagent's file change cannot be previewed, so it offers only Don't allow. |
| Questions | AskUserQuestion, always shown as a question. | Native questions, mostly in Plan first. |
| Actions that run without asking | Supported. | Not supported. |
| Requests Pocket cannot show | Denied with "This interactive request is not supported in Pocket Code." | Declined (MCP elicitation requests are cancelled). |

Deny rules and organization policies in the agent's own settings still apply in both modes. A Codex file change that asks
for write access to a whole folder, or whose changes Pocket cannot preview, cannot be allowed.

### Records

Every request and decision is written to `approval-decisions.jsonl` in `POCKET_DATA_DIR` (which defaults to the Pocket Code
directory) before Pocket answers the agent: identifiers, the request kind, a hash of the request, and the decision. It
never contains commands, arguments or file contents. If the record cannot be written, nothing is approved. Questions and
answers are not recorded there.

A decision is tied to one conversation, one live reply and one request. Repeating the same decision is harmless;
answering a request differently from a second device is refused; a decision for a reply that has ended is refused. At
most 20 requests (and 20 question sets) can wait per reply.

### Settings

| Setting or variable | Effect |
|---|---|
| `POCKET_APPROVAL_MODE` | The install default: `review` (default) or `full`. |
| `POCKET_ALLOW_FULL_ACCESS=0` | Removes Full access from the picker and refuses it at the server. |
| `POCKET_TRUSTED_ACTIONS` | The server's list of actions that run without asking: one rule per line, or several separated by commas outside parentheses. Used until a list is saved in Settings. |
| **Settings → Agents & instance → Actions that run without asking** | The owner's list, saved for the whole install (`trustedActions` in `pocket-settings.json`). Up to 50 rules. |
| **Settings → Notifications & voice → Finished replies** | Per device: also controls question and approval notifications. |

Variables go in the Pocket Code directory's `.env`; restart Pocket after changing them.

## For agents

- **Ask with your native question tool** when you need a decision while you work. Pocket shows it as a form and notifies the
  user. Give 2 to 4 clear options with short descriptions; the user can always type their own answer.
- **Expect to be skipped.** If the tool result says the user skipped the questions and sent a message instead, respond to
  that message; ask again only if you still need the answer.
- **A denial is final for that action.** When a tool call is denied ("The user denied this action. Do not run it through
  another tool."), do not reach the same result another way. Explain what you needed and let the user decide.
- **A restart denial is different.** "Pocket Code restarted while this request was waiting. Request it again if it is
  still needed." means nobody answered; request it again.
- **Keep commands plain under Review actions.** A command on the owner's list runs without a card only when it is one
  simple command, written exactly as listed: no `cd somewhere &&`, pipes, redirection, `$( )`, environment-variable
  prefixes or full paths. Run it on its own to avoid an unnecessary card.
- **Do not change the permission mode or the trusted list yourself.** They are the owner's choice. If Review actions makes
  a task impractical, say so and suggest Full access or a specific rule; the owner sets it in the app.
- **Explaining modes to a user:** Review actions asks before anything that runs or changes; Full access runs with the
  server account's access. Neither is an isolation boundary between people who share a Pocket sign-in. See
  [the security model](../../SECURITY.md).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| New replies default to Review actions although `POCKET_APPROVAL_MODE=full`; the log says "POCKET_APPROVAL_MODE=full conflicts with POCKET_ALLOW_FULL_ACCESS=0" | Full access is turned off, so Pocket starts in Review actions. | Remove one of them and restart Pocket. |
| The log says "POCKET_APPROVAL_MODE=… is not review or full" | `POCKET_APPROVAL_MODE` is set to something other than `review` or `full`; Pocket starts in Review actions. | Fix the value and restart Pocket. |
| Full access is missing from the permissions sheet | `POCKET_ALLOW_FULL_ACCESS=0`, or the browser could not load the instance policy. | Check `.env`; reload. |
| A queued message shows **Needs review** with "Full access is turned off on this server; send it again with Review actions." | It was queued with Full access, which the server has since turned off. It did not start. | Remove it and send it again with Review actions. |
| "This action is no longer waiting. Refresh the approvals." | The reply ended, was stopped, or the request was withdrawn. | Read the conversation; send a new message if needed. |
| "This action was already answered differently." | Another device answered first. | Refresh; the first answer stands. |
| "Could not record this decision. Nothing was approved; try again." | `approval-decisions.jsonl` could not be written (disk full, permissions). | Fix the data directory, then try again. |
| **Approval delivery uncertain** / "Delivery of this decision is uncertain…" | The decision was recorded but could not be confirmed as delivered to the agent. | Stop the reply and review the conversation. Do not approve again. |
| **Approval connection interrupted** or **Question interrupted** | Pocket restarted and cannot reach the agent process's input. | **Stop interrupted reply**, review, send a new message. |
| "This question was already answered differently." | Another device answered first. | Refresh the conversation. |
| A listed action still shows a card | The command was chained, piped, redirected, prefixed with `VAR=value`, called by path, or Codex is running; or the reply is in Full access (no cards at all). | See the matching rules in [Action approvals](../action-approvals.md#actions-that-run-without-asking). |
| No notification for a question or approval | The conversation is muted, **Finished replies** is off on that device, or push is not set up. | Check the **Alerts** chip and **Settings → Notifications & voice**. |

Deeper reference, including restart handling and rollback: [Action approvals](../action-approvals.md) and
[Operations](../operations.md#restarted-questions-and-approvals).
