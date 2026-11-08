# DESIGN.md — Pocket Code

**Mode:** Operate. The user completes tasks: open session → read → send → done.
Scanability and native feel outrank expression; brand lives in warm material and one accent.

**World: "warm ink workbench."** A quiet, warm near-black surface — paper-in-lamplight, not
terminal green-on-black. Chat reads like a document. The machine's activity (tool calls) is
visibly *machinery*: small monospace ledger lines, dim, truthful. One living element: the
clay ember that breathes while Claude works.

## Handoff offer (1.102)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 2, density 5; existing tokens, components and
the existing hand icon, no new colour. Read: someone deep in a long conversation should be able to move to a fresh one
in one tap, and be told once, quietly, when the size starts to cost them, without Pocket ever acting on its own.
**Handoff** is a toolbar chip beside Branch on a computer (`IC.hand`, icon-only when the row is narrow), an icon in the
Working row while a reply runs, and a choice under Branch in Conversation options. The offer is one line of `--dim`
13.5px text (max 60ch) under the latest finished reply, after Try harder when that shows, with the existing `.chip`
**Hand off** and a quiet text button **Not now**; both are 44px targets and wrap under the text on a phone. No card,
no border, no animation: it is a sentence, not a banner. It hides while anything is running, waiting for an answer or
typed, so it never competes with live work. Past the same threshold the context ring takes the existing amber level.
When the reply ends with suggested replies, the line gives way to one more button at the end of them, **Hand off first**:
the `.choice` shape in a quiet outline (`--line` border, `--dim` text, no fill, the hand icon), so it reads as a way
out rather than another answer, and the recommended reply stays the one filled button.

## A pin on every conversation row (1.94, Damon)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 2, density 8; existing tokens and the
existing pin icon, no new colour. Read: someone who organizes by pinning should pin or unpin in one click, without the
⋯ sheet, and the list should not get louder for people who never pin. Each row's trailing controls read pin, grip
(pinned rows, from 900px) and ⋯. The pin is a 44px target (36×44 with a fine pointer, so a pinned row in the 320px
rail keeps its title room): the outline pin in `--faint` at 55% opacity when unpinned, full on hover or focus with the
`--surface` wash the ⋯ uses; the filled pin in `--clay` when pinned, `aria-pressed` carrying the state. It replaces
the pin mark in the meta line, so the pinned state is shown once. In the sheet, Pin/Unpin is the first choice.

## CLI updates (1.85)

Pinned Operate extension: variance 2, motion 1, density 5. The existing warm ink palette and
settings controls remain the visual authority. A full-width, 44px-minimum notice sits inside the
conversation surface, reserving space instead of covering controls. It never opens itself or sends
an overnight push. Review uses the existing sheet, two separated provider rows, native checkboxes,
publisher release links, and one **Upgrade selected** action. Progress, failures, partial success,
and older running sessions are text, with no speculative progress bar. Each older process is named,
marked idle or working, and gets one explicit switch control. Stopping work requires confirmation
because a reply can be incomplete. Phone actions wrap; the sheet stays within 640px on desktop.
Closing it preserves the server job.

## The / picker (1.83)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 2, density 7; existing tokens, no new colour.
Read: one person who knows the terminal's `/` list and wants the same reach on a phone and a computer. It stays the
`.slash` panel above the message box (`--surface`, hairline `--line`, `--shadow-menu`, radius 14px), now grouped:
**Claude Code**, **Pocket**, **Skills**, each a sticky 12.5px/600 `--dim` sentence-case heading over a hairline (not an
uppercase eyebrow). A command is the ledger mono in `--clay`, an optional argument in 13px mono `--faint` in brackets, the
description 13px `--faint` with an ellipsis. The selected row and hover are `--raised`. On a phone a row is two lines,
full width, at least 44px; from 900px the panel is a 640px menu at the box's left edge, one line per row (min 36px), names
in a 13ch column so the descriptions line up, up to 60vh. No motion: it appears with the text that summons it.
Detector on the open picker (1440, 390): the documented slash-menu shadow advisory, and text-occlusion reports for rows
past the panel's own scroll edge and for the message the open menu covers; both are reached by scrolling or closing it.

## Answer from the banner, and subagents in view (1.82)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5; existing tokens and
components, no new colour. Read: a person on a phone who gets a permission request several times an hour and wants
it to be one tap, and who wants to know what the helpers are doing. The 1.75.4 banner keeps its material (`--warn`
hairline and 12% wash, the drawn mark, 15px/600 title, 13.5px `--dim` note) and becomes a group. With one item
waiting, the title is the request itself in plain words (the 1.59 phrasing), the note is the command or path in the
ledger mono clamped to two lines, and the actions sit where the single button was: **Don't allow** as a 36px
`--warn`-outlined button on `--surface`, **Allow** filled `--warn` in `--on-warn` ink, then **Details** in the cta
style with its chevron; a question's options are the same outlined buttons. Below 600px the actions take a second
row, right-aligned, so the title keeps its width. The asking subagent is one 13px/600 `--warn` line under the title
(**From subagent: Review imports**), repeated in the approval card. Sheets close themselves after the answer and say
what was sent in the toast, because the thing to do is done. The Subagents row keeps its 44px `--clay` text style and
gains the background jobs; inside a row, **Show activity** is a `.chip` and the transcript is the conversation's own
ledger lines and prose in a 48dvh box on `--bg` with a hairline, steps unfolded, the parent's instructions in
13.5px `--dim`. No new motion.

## Features in Assistant mode (1.81)

Pinned Operate refinement (variance 2, motion 1, density 5); existing tokens and components, no new colour. Read: a
non-developer who has to switch a feature on once and is told plainly when they cannot. **Settings → Features** sits
between Accounts and Notifications & voice. It moves the Developer category's own controls, so nothing is drawn twice:
a `.title-note` lead in the `.model-offer` block style, the five `.opt` switches (Projects, Files, Tasks, Inbox Watch,
Vault) with Inbox Watch's schedule button under its switch, then the Automatic model choice block unchanged. When the
mode is locked the panel is the lead alone, rewritten as a status line ("Projects and Tasks are on. Files, Inbox Watch
and Vault are off. To change them, ask the person who runs this install."); no switch is drawn, because a disabled one
would have nothing to say. A library that is off points to Features, or (locked) to the person who runs the install,
with no Open Settings button.

## Rail switch: named entries and the main area's mark (1.76.2)

Pinned Operate brief (variance 2, motion 1, density tight). With five or more entries the switch is a row of equal
columns, each a 20px glyph over an 11px/600 name, and takes the rail head's first row (actions wrap to the second);
idle entries in `--text` 72% over `--surface`, pressed in `--text` on `--raised`, hover a 55% `--raised` wash. One
silhouette per entry (bubble, flag, page, circle, lock, envelope; the flag since 1.76.4); the folder is the workspace
glyph, not Projects, and the paper clip means Attach, not Files.
Below 300px of rail it is icons with only the pressed entry named. Pressed = the rail's list; `aria-current` = the
main area's view, drawn as a 16×2px clay bar under the entry when the two differ. No new colour.

## Waiting-on-you banners (1.75.4)

The question and approval banners under the conversation header are a thing to do, not a notice. Same pinned Operate
brief (variance 2, motion 2, density unchanged). `--warn` carries it, because amber already means waiting on you (tab
mark, status bar): 1px `--warn` border, fill `--warn` 12% over `--surface` (18% on hover), a 22px drawn mark in `--warn`
(question mark; info mark for approvals), a 15px/600 title naming what is waiting with its count, a 13.5px `--dim` note
saying whether the reply is paused, and a 36px `--warn` button in `--on-warn` ink (**Answer**, **Answer all**,
**Review**, **Retry**) with a chevron. The whole banner is the control. Not clay-deep: that is your own message's
material, which is why the old banner read as one. Not green: `--ok` means working or done. Below 420px the mark goes.

## Your rules (1.73)

The first block of the Inbox Watch sheet, both modes: the set head *Your rules*, a lead that says they win and that Not
useful adds to them, a plain textarea (the field style of *Name*, 200px tall, vertical resize, three example rules as the
placeholder) and a character count as a `.title-note`. No new colour.

## Inbox: the read dot and the started conversation (1.77)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 7; existing tokens and icons, no
new colour. Read: an owner scanning a dense list who needs to see at a glance what is unread and what is already being
handled. The 44px gutter (`.inbox-marks`) holds a 16px dot level with the title's first line: filled clay while unread,
a `--dim` 1.6 ring once read. The dot is its own control (mark read, mark unread) and never opens the entry; the eye of
1.75.2 read the same both ways and only repeated the row's tap. On a finished entry the ring is a plain mark, not a
button. When a conversation was started from the entry's briefing, the bubble glyph (`IC.chat`, 17px, `--text`) sits as
a 44px link right under the dot and opens it. The sheet leads with **Open the conversation** (the bubble, with when it
started) above **Start another conversation**. The 1.75.2 lesson stands: a mark keeps one meaning and one shape.

## Inbox: Open and Done, and keeping it tidy (1.71)

Same pinned Inbox brief (variance 2, motion 1, density 5). The chips read **Open · Unread · Done**: Open is the default
(everything still on the list), Done gathers what is finished. A finished row shows its note (why it was finished) in the
line where an open row shows the alert's first sentence, so Done reads as a log. The settings sheet gains *Keep the Inbox
tidy* after *Quiet hours and summaries*, in both modes: the set head, a one-line lead, an `.opt` switch and the *How often*
select in the pair grid; no new colour.

## Inbox Watch: schedule, models and cost (1.70)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5 in Developer mode (3 / 2 / 3 in
Assistant mode); existing tokens, no new colour. Read: one person tuning their inbox watcher, phone first, set once and
glanced at after. One sheet (`.watch-sheet`, 640px on a desk) opened from Settings (*Schedule, models and cost*, an `.opt`
row under the Inbox Watch switch) and from a **Schedule** chip beside the Inbox search box. Top to bottom: a status
`.title-note` that says what is in force now and when the next check is; **Pause** as an `.opt` switch; then the 1.67
blocks (uppercase set head, lead, controls): *Schedule* (the rest-of-the-time `select`, one `.router-level` row per
period: name input with **Remove**, seven 44px day chips on one grid row with the filter-chip clay when pressed, *From*
/ *Until* time inputs and the interval, three across from 600px), *Quiet hours and summaries* (paired hour selects),
*Models* (the 1.67 level rows: name with what it is for, Model and Reasoning), *First pass* (an `.opt` switch, the
classifier and confidence selects as a pair), *Cost, last 7 days* (a plain table,
tabular figures, hairline rows, *Not recorded* in `--dim` before recording began, a bold total). **Save** is the one
primary; *Use the config file's settings* a chip beneath. Assistant mode drops Models and Cost: no model name or dollar
figure reaches a seat. Notes cap at 58ch with `text-wrap: pretty`.

## Automatic model choice and one sign-in in Settings (1.67)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5; existing tokens, no new
colour. Read: an owner's switchboard, set once, explained where it says no. Both blocks sit in **Agents & instance**
after *Actions that run without asking*, built like *Claude models in the picker*: the uppercase set head, a
one-line lead, then controls. Automatic model choice: an `.opt` switch, the decision model `select`, a password key
field with **Save key** (the key is never shown again; the note says where the active key comes from), then one
row per level (name 15.5px/600 with what it is for at 13.5px `--dim`; Model and Effort selects side by side,
stacked under 520px; "Runs …" as a `.title-note`), the status note and *Use the server's settings*. One sign-in:
status line, three `.voice-field` inputs, a `--err` line, **Save**, **Turn off**, *Use the server's values*.

## Try harder (1.62)

Assistant mode's only model control, phrased as an outcome. A `.chip` labelled **Try harder**
sits just under the latest finished Claude reply (outside it, so copying or reading the reply
never includes it), hidden while a reply is running. No model name appears anywhere.

## Files in the conversation (1.61)

Pinned Operate refinement: variance 2, motion 1, density 5; existing tokens, no new colour. Read:
a file you were handed should look like a file, not a path. Under the reply that names it, a
`.file-card` on `--surface` with a hairline and 12px radius (max 640px): a 72×56 picture (the
PDF's first page, cover-fit to the top) or a type tile in the ledger mono at 12px `--dim`, the
name at 15.5px/600 in `--text`, the type at 13.5px `--dim`, then **Keep in Files** (or **In
Files** in `--ok`) and **Download** chips, right-aligned and wrapping under the name on a phone.
The card is one 56px link that opens like any link here (Settings → Open files and links).

## Assistant mode (1.60)

Pinned brief (design-studio → impeccable): variance 3, motion 2, density 3; existing tokens, no
new colour. Read: a calm assistant for office staff, leaning "well-made notes app", one obvious
next step on every screen. Plan: `docs/plans/assistant-mode.md`.

One class, `html.assistant`, carries it. It **hides**; it doesn't restyle the workbench, so
turning it off restores 1.59 exactly. Home is the New conversation pane with `.assistant-home`:
a dismissible `.assistant-intro` on `--raised` (promising "I'll ask before I send…" only when the
next turn is Review actions), **Waiting for you** cards (56px, 12px radius, a `--warn`-tinted
border, title 16px/600, the reason 14px `--dim`), **Recent** as 52px rows (a 8px state dot:
`--warn` needs you, `--ok` working, `--err` didn't finish, clay ready; title 16px; time 13.5px
`--dim`), **See all conversations** as a 44px clay link, then the library chips. Section heads are
13px uppercase `--dim`. On a wide screen with the list open, Recent is left to the list.
Hidden in Assistant mode: the composer chips and toggle, Choose a skill, Save as prompt, the cache
ring, alerts, the steer choice, Results / Queue / Git / changed files / split, the folder name, the
idle state, the cost line, the raw part of steps and the command block under an approval (the
full request stays in Show details), list filters, summary and footnote. The app name is
**Pocket Assistant**.

## Plain words, steps and approval cards (1.59)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5;
existing tokens, no new colour. Read: the same workbench in words a non-developer can follow,
with nothing taken away from the developer. Plan: `docs/plans/assistant-mode.md`.

**Words.** Visible text says *conversation*, not *session*; *reply*, not *turn*. Ids, routes,
keys, file names and log lines keep the old words. Glossary for new text:

| Say | Not |
|---|---|
| Conversation, New conversation | Session, New session |
| Reply… (message box) | Message this session… |
| Allow / Don't allow | Allow once / Deny |
| Waiting for your OK | Action needs approval |
| Something went wrong. Tap to see what happened | Turn failed — tap to see why |
| Stopped | Turn ended |
| Nothing running | No confirmed runs |
| Chats (the sidebar switch only, where width is tight) | Sessions |

**Steps.** A tool call reads as a plain past-tense step in the UI font at 14px `--dim`
("Saved Proposal.pdf", "Checked Gmail", "Started a helper: Map the UI"), worded by
`public/phrases.js`. The raw call stays beside it in the ledger monospace at 12px `--faint`
only when it adds something (a full path, a command); a Bash description already is the step.
The fold summary reads "3 steps · Saved Proposal.pdf" in the UI font. **Settings → Conversation →
Describe steps in plain words** (this device, default on) off restores the pre-1.59 mono name and
detail everywhere, through `html.raw-steps`. Monospace stays reserved for machinery.

**Approval cards.** The title is the request as a question ("Save Proposal.pdf?", "Run: Convert
the deck to PDF?", "Make a Gmail draft?"). Under it, the folder in `--dim` and the whole
command, path or address in the mono block, never clipped. Broad grants (permissions, network)
keep their scope sentence in view. The full request sits behind **Show details** (44px summary),
open by default when Pocket can't summarise the request. Buttons: **Don't allow**, then the clay
**Allow**. The approval engine and audit are unchanged; only the words and order are.

## Actions that run without asking (1.56)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5;
existing tokens, no new colour. Read: a short allow-list the owner edits rarely, explained where
it says no. **Settings → Agents & instance** gains the block under *Claude models in the picker*,
built the same way: the uppercase set head, a one-line `.title-note` lead, then one 52px row per
rule with the rule in the ledger monospace at 14px (it is a command, so mono is earned) and a
**Remove** chip, hairlines between rows. Below, *Add an action*: a mono field and an **Add** chip
in the email setting's field-and-chip arrangement; the server's reason for a refused rule sits under
the field in `--err`, the field takes `aria-invalid` and an `--err` border and keeps the text for
fixing. A dim syntax line follows, then the status note saying where the list comes from (chosen
here, or `POCKET_TRUSTED_ACTIONS` with any rules it skipped), and *Use the server's list* once a
list is saved. Removing a row moves focus to the row that takes its place, else to the field.
Rendered checks at 1440 and 390: axe clean, no horizontal overflow. The detector reports the
existing baseline (sheet shadow, system font, session footnote) and flags the 31-character
uppercase set head as all-caps body text; kept, since it is a one-line label in the established
set-head style and names the setting the way the request did.

## Connectors (1.53)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 2, density 5;
existing tokens, no new colour. Read: a place to check, once, that each agent can reach the
owner's Google account, and a way to the page that connects it. **Settings → Agents & instance**
gains a *Connectors* `.opt` row (globe icon) under Accounts & instance; it opens a sheet built
like Accounts: a `.sheet-help` lead, one `.provider-account` section per agent, then a list of
rows (15.5px label, 14px state line, 52px rows) with a **Connect**/**Reconnect** link chip on the
right only where action is needed, a *Manage on claude.ai / chatgpt.com* chip, and **Refresh
status**. States are words first; colour only repeats them (`--ok` connected, `--warn` needs
signing in again, `--err` could not connect, `--dim` otherwise). A provider that cannot use
connectors shows one sentence saying why, never a disabled button. Rendered checks at 390 and
1440: axe clean.

## Claude models in the picker (1.52)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 5;
existing tokens, no new colour. Read: a checklist for the whole install, explained where it
says no. **Settings → Agents & instance** gains a *Claude models in the picker* block under
Plan usage: the Vault's uppercase set head, then the catalog as the notification kinds' option
rows (15.5px, 10px padding, the clay dot for on), a `.title-note` status line saying where the
list comes from, and a *Use the server's list* chip once a choice is saved. A model this
computer's Claude Code policy blocks keeps its row: dashed ring, `--dim` label, the reason in
place of its description, `aria-disabled` so it stays focusable and explains itself in a toast.
The rows are drawn from the client's catalog before `/api/settings` answers, so the centered
desktop dialog does not grow under the pointer; the dashed ring is reserved for blocked rows,
not loading. Rendered checks at 1440 and 390: axe clean; the detector reports only the existing
sheet shadow and system font.

## Claude account switch control (1.51)

Pinned Operate refinement: variance 3, motion 1, density 5. The Claude Code account row
shows the active turn count with **Stop all Claude turns** beside **Switch account**; the
stop chip uses the existing error colour and stays disabled at zero. An inline second
step names the live count and the effect on child processes before any stop request.
After confirmation, the row reports progress until the count reaches zero, then directs
the owner to switch accounts. Codex stays a separate row. Phone and desktop checks cover
cancel, confirm, the zero state and accessibility without a new modal or visual language.
The rendered detector pass at 390 and 1440 found only the existing sheet's flat type scale
and wide dialog shadow; the new disabled stop chip's contrast finding was fixed.

## The due list and notification settings (1.50)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 2, density 5;
existing tokens, no new colour. Read: one place for everything with a time, and one place to
say how it reaches you. A project reminder in the Tasks list is a task row: the hourglass takes
the check's 44px slot and opens the reminder's options, the row is a link to the card, and the
status line reads due/date · project · step in the `--warn` due voice. Due items sort by time,
tasks and reminders together, so the list needs no second group. The badge moves, it does not
multiply: with Tasks on, the Tasks segment, chip, tab mark and the app icon carry the one
count, and the Projects segment goes quiet (a card and its tab still mark their own). Settings →
Notifications & voice keeps the `.opt` rows: *Push to this device*, then the three kinds as
indented rows (`.push-kinds`, 24px in, 15.5px), *Count on the app icon*, *Notice a day before*,
and the email address as a `.voice-field` with Save / Send a test chips in the Vault's
field-and-chips arrangement; the instance-wide rows sit under their own scope heading.
Rendered checks: the list at 1440 and 390 (no horizontal overflow), the Notifications panel;
axe clean on each; the detector reports only the app-shell baseline.

## Files: select and delete (1.45)

Pinned Operate refinement: variance 3, motion 2, density 6; existing tokens, no new colour.
Read: cleanup, not a file manager. **Select** is a chip beside Upload (the task-square icon);
pressed it reads **Done** in the pressed-filter clay state and Upload steps aside. In select
mode a row or card is a `<label>` for its 20px clay checkbox, with no link or options, so a
tap anywhere picks it: a picked row takes `--raised`, a picked card the `--clay` border, and
a card's checkbox sits on the picture in the same 40px translucent chip as its actions. A
bar sticks to the foot of the library (`--surface`, `--line` top hairline): the count as
status text, then *Select all N* / *Clear* and **Remove N** chips. The selection never
outlives what is shown. The Trash is a disclosure with ▸/▾ like the ledgers; each row has
*Restore* and the options button, whose sheet adds **Delete forever**. **Empty trash** sits
beside the Trash's help line. Delete forever and Empty trash are the only `--err` controls,
the saved-prompt *Delete for good* precedent, and each confirms once in the existing sheet.
Rendered checks: select mode in the list at 1440 and 390 (no horizontal overflow) and in the
grid, the open Trash; axe clean on each; the detector reports only the app-shell baseline.

## Vault (1.39)

Pinned Operate refinement: variance 3, motion 1, density 6; existing tokens, no new colour.
Read: the Vault is a fourth library in the session-row voice, not a password manager. Rows
carry the item's name in mono (it is what agents type), its kind, the policy in words
(*Ask*, *Auto*, *Owner*), expiry and last use. Values are absent by default: the item sheet
lists each field with **Show** and **Copy**, one field fetched per tap. Policy reuses `.opt`
rows; recipes read as mono command lines; the history is a collapsed ledger like a
project's.

A pending request is the one thing that needs attention: the item, the command in mono and
the session, with *Allow once*, *Always allow* and *Deny*, where *Always allow* says it saves
the exact command. The add sheet is a plain form whose value never reaches the draft, local
storage or the recent prompts. **Store in the Vault** is one more option in the composer's
attach sheet and a session's options, not a new toolbar button. Settings → Vault states the
key requirement in words with the generation command in mono, and shows a rotated key once.

Rendered checks: no horizontal overflow at 390 for the list, an item sheet and a request;
axe clean on each; the detector reports only the app-shell baseline.

**Finding and answering (1.93, Damon).** Pinned Operate refinement: variance 2, motion 2,
density 6; existing tokens only. The list sorts **Newest first** (an **Order** select beside
**Search secrets** offers A–Z), reusing the Files toolbar (`.documents-tools`,
`.session-search`, `.voice-field`). A secret under a day old carries a small clay-outline
**New** pill, and its facts line leads with where it was added. A deep link marks its row
with `.vault-flash`: the raised surface and a 3px inset clay bar, fading over 2.6s (no
transition under reduced motion). A request reads as one sentence, *The agent in "…" wants to
use **name** for this command*, at body size with the who and the name in 650 weight; it is
the only place the Vault uses a filled accent button: **Allow once** is `--clay` with
`--on-accent` text, 44px tall, beside an outlined **Deny** of the same size, with *Always
allow* staying a chip between them. A notice that a notification's answer failed, or that a
request already ended, is a bordered `--warn` line, never a toast. A secret a conversation
stored gets a file card (`.vault-card`) with the kind icon in the thumbnail slot and "In the
Vault" where Files says "In Files".

## Appearance modes (1.38)

Pinned Operate refinement: variance 3, motion 2, density 7. Preserve layouts, native type,
control vocabulary and accent choices. Dark remains warm ink; light is warm paper
(`#FAF8F5`) with ink text and darker accents. All palettes live in `public/app.css`.
`data-theme` chooses the mode and `data-accent` chooses orange, blue or purple. Semantic
foregrounds cover accent buttons, warning badges and user bubbles; shadows and diff tints
also follow the mode. Blue and purple's dark pairs and error red are adjusted for contrast.

`theme.js` runs before CSS and body scripts, with no inline script or CSP exception.
`pc-theme` stores `system`, `light` or `dark`; `pc-accent` keeps its existing values. A new
browser defaults to System; a browser carrying older `pc-*` preferences retains Dark.
Storage failures fall back to an in-memory preference. Native controls use the resolved
`color-scheme`, and browser chrome follows `--bg`. Same-origin storage events synchronize
windows and panes in place; OS changes affect System only. Document iframes retain a
light canvas and may still implement their own theme internally. Media is not recoloured.

Settings → Appearance uses a labelled native select above text size and highlight colour.
No theme animation or screen rebuild: drafts, focus, scroll and active streams stay in place.
Installed launch screens and static icons remain manifest-controlled; verify them on devices.

## Sidebar header (1.33.1)

The resizable rail is an inline-size container. Navigation type, padding and mouse
actions compress with its available width, including a native scrollbar. Icon
actions stay 44px tall (and 44px wide on touch); if the two groups cannot fit,
Filters, Settings and New session wrap together. Never clip the New session action.

## Workspace consistency (1.33)

Pinned Operate refinement: variance 3, motion 2, density 4. Preserve the warm ink,
clay accent, native type and existing control vocabulary. Settings opens six plain
navigation rows with short descriptions; categories name device/instance scope,
keep their existing controls, and use All settings or Back to Settings for the parent.
Close exits the flow. Initial dialog focus targets a visible control.

New session uses the conversation's composer (1.58): settings chips (model, reasoning,
permissions, Codex mode) scroll above the box; attach, the settings toggle, a drawn spark
for Choose a skill and a bookmark for Save as prompt sit in its action cluster; mic,
headset and the clay Send (named Start session) on the right. Above it, the task heading,
saved prompts and one outlined setup disclosure naming workspace, agent and permissions;
inside, agent, project and custom path. The linked project keeps its own 44px context row.

Library Back restores its origin and scroll; load errors offer Retry and label cached
data. The rail uses button-group semantics with arrow/Home/End shortcuts. Split view
uses search and named groups, with a count when results are limited. Document filters,
preview actions and running-chat mute controls use 44px hit areas. Wide table cues
occupy a reserved margin so appearing text cannot shift a restored reading position.

## The library as a grid of previews (1.32)

Pinned Operate refinement: variance 3, motion 1, density 6; existing tokens. Read: on a wide
screen a library of reports is found by sight, so the default is a grid of pictures, with the
rows one click away and the only layout on a phone. A card is `--surface` with a `--line`
hairline and 12px radius: a 16:10 picture on `--raised` (object-fit cover, pinned to the top
so a report's title shows), then the row's words at list sizes (15px title clamped to two
lines, 12.5px `--faint` origin, the visibility badge and date). While the picture is loading
or when there is none the kind word sits in the middle of the picture area in its mono pill.
Hover or focus turns the border `--clay-deep`; the current document's card is `--clay`.
Copy link and the options button float on the picture, 40px, on a translucent `--bg` chip,
visible on hover or focus and always on a touch screen. The grid is `auto-fill, minmax(230px,
1fr)` with 14px gaps, which gives four columns beside the rail at 1440 and three on a tablet.
List and Grid are two 40px icon buttons beside Upload (the pressed one on `--raised`), hidden
under 700px. Motion: the picture fades in over 200ms when it arrives; nothing else moves.

Rendered checks: the grid at 1440 (with the rail) and 768, the phone list at 390 with no
horizontal overflow; axe clean on the grid; the source detector reports only the app-shell
baseline.

## Open modes, library filters and desktop dialogs (1.31)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 1, density 6;
existing tokens. Read: the library must work like a library (find, filter, copy a link in
one tap) and every view must open the way the reader wants (tab, pane, own window), while
the sheets stop looking like a phone drawer on a 1440px screen.

Desktop sheets (≥ 900px) are centred dialogs: `width: min(560px, 100vw - 48px)`
(760px for Results), a `--line` border, 16px radius, an offset soft shadow, and a 160ms
fade-and-settle in place of the drawer's rise; phones keep the bottom sheet. Link rows in a
sheet and link chips inherit the row's colour with no underline. The library's filter row
is `.chip`s with counts in `--faint` tabular numerals (the pressed one takes the existing
clay chip state), beside the Project and Kind `.voice-field` selects; each row's
visibility is a hairline badge in the `.project-status` voice (uppercase 11px, `--dim`;
`--clay` when Link or Public, the one accent) and a shared row gets a 44px link-icon copy
button beside its options. Options sheets group into Open · Share · Organize with the
existing `.opt-group` rule. Three new 24px icons in the one stroke weight: `external`
(arrow leaving a box), `link` (two chain links), `share` (three joined nodes). A solo window
(`?solo=1`) is the chatcol alone: the view's bar without back, rail or pane controls, and
the view's name as the document title.

Rendered checks: no horizontal overflow at 390 for the library and a document; axe clean on
the library, a document, the share sheet and the phone views (33 scans in the browser
suite); the source detector reports only the app-shell baseline (ember dot, radial halo).

## Documents (1.30)

Pinned Operate refinement: variance 3, motion 1, density 6; existing tokens. Read: the
library in the session-row voice with one small mono kind tag (`HTML`, `PDF`, `MD` … in a
`--raised` pill, 11px), the viewer as a frame under Pocket's bar with a row of chips above it
(Open in your viewer, Download, Share, Project, Session). No new colour: a shared document
says *Link* or *Public* in words; the Share chip takes the existing `.set` accent when the
document is not private. The HTML frame is white (the document's own canvas), PDFs use the
browser's viewer, Markdown reuses the reply typography (`.m-asst`), CSV becomes a sticky-
header table in tabular numerals. The share sheet reuses `.opt` rows for the three
visibilities, a mono read-only URL field with Copy, and the `.voice-field` select for
expiry. The rail head grows a third segment, *Docs*, kept short so Sessions · Projects ·
Docs fits the 320px rail. (Docs became *Files* in 1.34, and Tasks added a fourth segment in
1.36: the switch now reads Sessions | Projects | Files | Tasks.)

Rendered checks: no horizontal overflow at 390 for the library and an HTML document; axe
clean on the library, the HTML document and the phone view; the detector reports only the
app-shell baseline; the sandbox probe in the fixture dashboard reports isolation.

## Projects (1.29)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 1, density 6.
Read: the tracked-project board as part of the workbench, in the session-row voice, not a
dashboard. Existing tokens only; the rail switch is the only new control.

The list and Scheduled reuse `.session-item` rows: title, a two-line meta (the next step),
and a `.session-status` line with the project's linked-session marks (the same 7px marks
as tabs) and a due label in `--warn`. Groups are Active, Waiting and Done (a collapsed
`<details>`). The card is a document: a status word in a hairline chip (Active in `--ok`,
Waiting in `--warn`, Done in `--dim`; no fill), a mono meta line (updated, verified),
labelled sections with uppercase 13px `--dim` headings, the checklist as 44px rows with a
clay-accented checkbox and a reminder date in the row (under the step on phones), the
reminders, the linked sessions as session rows, a note form, history as a collapsed ledger,
and the actions as chips. Sheets reuse `.opt` rows and the `.voice-field` inputs; the
editor and the reminder picker are plain forms in a sheet.

Desktop: the rail head is a two-way `role=tablist` switch, Sessions · Projects (now a `role=group` of pressed buttons, Sessions | Projects | Files | Tasks, one segment per feature that is on), with a
`--warn` badge for due reminders; beside it the filter toggle drops its label (icon only)
so the head fits the 320px rail, and hides in the project list. A project view is a tab in
the open-session strip (title; `tab-due` mark in `--warn`) and a pane target like a session,
because panes are full Pocket instances keyed by route. Phone: the session home gets a
Projects chip (amber when something is due); views are full-screen with the ordinary bar.

Rendered checks: no horizontal overflow at 390; axe clean on the list, card, split and
phone card; the detector reports only the app-shell baseline. 44px targets throughout
(the 20px checkbox sits in a 44px label).

## Prompt cache warmth (1.28)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 2, density 7. Read:
a quiet countdown on the existing context ring, not a new surface. Existing tokens only.
The ring button gains a 12px mono label: minutes left (`51m`) in `--dim` while warm,
`--warn` in the last stretch (ten minutes of an hour, a fifth of a shorter lifetime), `cold`
in `--dim` once expired. Without an estimate (Codex, no usage yet) the label is empty and the
ring stays a 44px square. The label repaints every 30 s; no motion. The tooltip and accessible
name append one sentence with the expiry time in ET.

Usage gains a **Prompt cache** block under This session, reusing the `.usage-row-head` and
`.ctx-facts` patterns: status (mono, amber while cooling), Expires/Expired, Cached, Lifetime
("assumed" when the CLI did not report one), the dated last-turn line, and one note that this
is an estimate. The reply turn line appends "97% cached" or "cold start" in its mono ledger voice.

Tabs mark only sessions with 100k+ cached tokens that are cooling (hourglass) or cold
(branched snowflake), 13px, `--dim`, after the status mark, `role=img` with the label. The
plain six-spoke version read as an asterisk at tab size, so each spoke has a branch. No
colour, so a cache mark never competes with the clay/amber/green/red session status; warm,
small and unconfirmed sessions show nothing.

Rendered scans (isolated server, synthetic transcripts, 390 and 1440): axe 0; the impeccable
detector reports only the documented app-shell baseline (`#app`, `#ctitle`, `#chat-statebar`,
`#slash`, native font), nothing on the new elements.

1.28.1: cold turns the ring **ice blue** (`--ice: #9FD4F0`, 11.8:1 on `--bg`, 9.7:1 on the
`--raised` hover). The one new token, a cool note against the warm palette that reads as frozen without joining
the clay/amber/green/red status language. Cold tints the fill, the dotted track (65% mix, so a nearly
empty ring still reads blue) and the label, and wins over the context level colour; the fill length
still carries context. The Usage status "Cold" uses it too. Tab snowflakes stay `--dim`. No motion.

## Model selection (1.27.2)

Preserve the existing controls, typography and spacing.
Pinned Operate brief: variance 3, motion 1, density 6. Switching agents clears an
incompatible model before painting the button; existing sessions repair the same
saved-state problem. Unrecognized models show their ID, never a misleading default
label. The Codex sheet includes the full advertised list and retains its scrolling.

Rendered 390px/1440px checks have no accessibility violations or findings on the
model controls. Retain the existing app-shell overflow, native-font and compact
type-hierarchy detector exceptions; this fix changes neither layout nor styling.

## Tab status (1.27)

1.27.1: clay means work in progress, amber (`--warn`) means waiting on you. The still clay
needs-you dot was hard to tell from the ember at 7px, so the tab mark, the session-list
label and the conversation status bar use amber for questions and approvals.

Pinned Operate brief: variance 3, motion 2, density 8. Open-session tabs repeat the rail
row's state as a 7px mark before the title, with no new colors or motion. Running reuses
the ember at the rail's 7px size. Needs-you is a still `--warn` amber dot, an unread reply `--ok`,
a failure `--err`, and activity elsewhere or a paused queue a 1.5px `--dim` ring. Idle,
read and unconfirmed states show nothing, so a mark always means a confirmed state. The
mark is `role=img` with the state as its label and adds no text to the tab.

## Claude account switching (1.26)

Claude account switching (1.26) extends Accounts & instance with the existing sheet,
chip and primary-button styles. Pinned Operate brief: variance 2, motion 1, density 5.
Keep the warm ink palette and native type. One link opens Claude, an adjacent Copy
link button supports another browser, and a labelled password field accepts the
return code. Status and errors remain beside the form. No new motion or decoration.
The sheet has a 16px inset on phones. Rendered phone/desktop review and accessibility
checks cover the form; the retained detector exceptions concern the existing app
shell, title ellipsis, table containment, native font and compact type hierarchy.
1.26.1 keeps the same layout and clarifies that background jobs keep running and
may keep their earlier login. Only current Claude turns block starting sign-in.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#131110` | page |
| `--surface` | `#1D1A18` | header, input bar, rows |
| `--raised` | `#272322` | pressed/selected, code blocks |
| `--line` | `#2E2A27` | hairlines |
| `--text` | `#EDE7E0` | primary text (13.9:1 on bg) |
| `--dim` | `#A99E93` | secondary (6.9:1 on bg) |
| `--faint` | `#AA9C91` | readable timestamps and ledger |
| `--clay` | `#D97757` | accent: send, ember, active dot, links |
| `--clay-deep` | `#3A241C` | user message surface |
| `--ok` | `#7FB069` | success flashes only |
| `--err` | `#E2685C` | errors |

Type: system-ui stack (Operate mode: native feel + zero font payload on mobile).
Chat body **17px/1.6**; session titles 16px/500; view titles 19px/650; ledger mono 12.5px
(`ui-monospace` — earned: it renders commands, paths, data). Radius: 14px surfaces, 10px chips.
Spacing: 8/16/24 rhythm; more air above headings than below.

## Motion — one identity

The **ember**: a 10px clay dot that breathes (scale 1→1.28, opacity .55→1, 1.6s ease-in-out
alternate) wherever Claude is working (session row, chat header, input bar). Messages and
ledger lines enter with a single 180ms ease-out rise (6px). Nothing else moves.

## Surfaces

- **Sessions:** grouped, hairline-separated rows with a two-line title, workspace/provider,
  explicit state and last activity. Search and filters share behavior across the home
  view, desktop rail and mobile switcher. Only confirmed runs show a running ember.
  Visible More buttons expose pin/rename; the bottom-right FAB starts a session.
- **Chat:** slim header (back chevron, 1-line title, project tag). User messages: right-aligned
  clay-deep chips, max-width 85%. Assistant: full-width document text. Tool calls: ledger lines
  `⌁ Bash  pm2 list` in mono/faint with drawn 14px stroke icons. Input bar pinned bottom,
  auto-growing textarea, clay circular send (arrow-up). While working: input stays usable-looking
  but disabled, ember + "working" in the bar.
- **New:** recent project dirs as radio rows + free path field, message box, single primary action.
- **Login:** centered, one field, one button.

Icons: authored inline SVG, 1.8px stroke, round caps — chevron-left, plus, arrow-up, folder,
terminal, doc, globe, gear (app settings, and the fallback tool icon), sliders (message settings,
permissions). No emoji as UI.

## Session workspace refinement (1.1)

Keep the warm charcoal/clay identity. Variance 4, motion 2, density 5. Status text
carries meaning without relying on color or animation. Dialogs contain keyboard
focus, close with Escape and restore focus. New toolbar targets are at least 44px.
Delivery errors preserve the message and show recovery actions beside the composer.

## Conversation workspace (1.2)

Reports retain document typography with real heading levels, nested lists and
quotes. Tables scroll in a named keyboard-focusable region without widening the
page. Results and Queue are visible next to the session switcher; phone sheets
use the available height, desktop sheets keep a bounded measure. New Session starts
with the task; skill discovery inserts editable instructions; workspace and agent setup
sit above the composer (1.58). Existing color/type identity stays pinned.

## Daily workspace (1.3)

Desktop retains a readable center conversation between the existing session rail
and an optional 350px Results/Queue/Git panel at 1280px+. Open-session tabs persist
locally; closing a tab never stops a turn. Phones use full-width sheets, and a
narrowed desktop panel moves into a dialog without discarding its fields. Workspace
and agent filters use native selects; all actions keep visible keyboard focus.
Question forms render only provider requests, have no preselected answers and
support free text. Git text is escaped and scroll-contained. Accounts display
identity metadata, never secrets. Existing warm charcoal/clay identity stays pinned.

Rendered phone/desktop scans and screenshots reviewed. Remaining flags are the
incumbent native font, intentional header/tab title ellipses, compact tool ledger,
existing slash-menu shadow and padded quote/message boxes. No low-contrast finding
on the new question form or workspace controls. Physical-device assistive-technology
certification is not claimed.

Source detector exceptions: the existing ember only pulses for confirmed owned
runs; it is functional state, not decorative liveness. The existing radial radio
selection fill is a control indicator. Both are retained from the pinned design.

## Compact desktop workspace (1.3.1)

Pinned refinement: variance 3, motion 1, density 8. Preserve the warm ink identity
and conversation typography. Reduce desktop chrome spacing on a 4px rhythm;
retain 44px targets. Independent disclosures hide tabs/subtitle or session filters,
keeping essential actions and warnings available. Active filters remain explained
and clearable. Change layout in place; preserve drafts, reading position and docks.
Desktop preferences do not hide phone controls.

Rendered desktop and mobile scans reviewed: native font, intentionally truncated
titles/tabs, existing table containment and compact header hierarchy are retained.
The existing slash-menu shadow is unchanged. Text-occlusion findings are report
paragraphs outside the conversation's scroll viewport, inspected with its composer
visible; they remain reachable by scrolling. No new contrast or touch-target
exceptions are introduced by the disclosures.

Conversation text has a per-browser 14–24px preference (17px default), exposed in
existing Session options and App Settings sheets to avoid extra permanent chrome.
Prose, report headings and tables scale together; table text has a 13px floor.
Code, tool ledgers and application controls keep their existing typography. The
14px prose minimum is an explicit user density preference; browser zoom remains
available. Both settings surfaces share one control with announced values, native
disabled bounds, a live sample and reset. Rendered phone/desktop scans at 24px have
only the existing ellipsis/table/shadow/native-font exceptions described above.

## Action approvals (1.4)

Pinned Operate brief: variance 3, motion 1, density 7. Keep the warm ink palette,
native text and existing sheet behavior. Pending-action banners are separate from
agent questions. Cards show complete escaped, scroll-contained details with explicit
Deny/Allow buttons, no preselected answer and no blanket permission shortcut. Native
turn-wide grants state their scope. Disabled uncertain replies direct users to review
and stop; closing a card never implies consent. Keep 44px targets and visible focus.
Rendered phone/desktop scans retain the existing title ellipsis, table containment,
native font, compact navigation and slash-menu shadow exceptions. Approval help copy
has a bounded measure and 16px outer padding.

## Responsive conversation workspace (1.5)

Pinned warm ink workbench; variance 3, motion 1, density 6. The conversation is one
continuous workspace across phone, Fold and desktop widths. Keep its flex columns
shrinkable and its composer outside the scrolling transcript, so viewport and keyboard
changes resize the existing DOM without losing the draft, selection or reading place.
At wider widths, the conversation and composer may span 1280px instead of the former
720px; narrower panes retain their own readable measure.

On phones, the 44px header controls remain reachable while optional status chrome
collapses. The composer stays in view, its text field has a bounded height, and its
single-row toolbar scrolls horizontally when actions do not fit. Attach opens a
choice between files and Paste screenshot; pasting an image directly into the
message field also attaches it. Plain text paste remains native.

Browser screenshots at closed Fold, open Fold and wide desktop widths preserve the
draft and visible composer. Compact layout increased the measured reading area by
93px (529px to 622px) in the test. These checks used emulated browser widths and a
synthetic visualViewport reduction; they do not certify behavior on a physical Fold.

The run-confirmation strip remains visible beneath the conversation header, including
in compact mode. It is28px tall with12px text, using existing status colors and a
non-animated check-age label. Only a fresh authenticated server response can confirm
a running turn; display age updates locally without renewing that confirmation.
Server checks occur every5seconds, become unconfirmed after failure or15seconds
without fresh proof, and distinguish waiting, finished and external activity.

## Split view and tooltips (1.6)

Pinned Operate brief: variance 3, motion 2, density 8; warm ink identity unchanged.
Desktop (900px+) shows up to four conversations side by side, like editor groups.
The main column keeps the rail, tabs and dock; each extra pane is a full Pocket window
in a frame, so streams, drafts, sheets, questions and approvals stay independent.
Panes share width equally (the main conversation gets the same share as a pane, after
the rail), with 5px hairline dividers matching the rail grip. Keyboard arrows resize;
double-click resets. Pane headers replace Back with Swap and add Close; nothing else
changes inside a pane. A new pane needs at least 380px per conversation. Phones never
show panes.

Tooltips explain icon-only and abbreviated controls on mouse hover (350ms) or keyboard
focus, never on touch. Raised surface, hairline border, 10px radius, 13px text, no
animation or shadow. Escape and pointer-down dismiss them. The control's accessible name
is unchanged; the tooltip is attached through aria-describedby while visible.
Split view lists New session first; a new pane shows the standard New session screen
with Close in place of Back and its own draft. Messages steered into a running turn
render immediately as ordinary user messages; no extra pending chrome.

## Session focus controls (1.7)

Pinned refinement: Operate, variance 3, motion 1, density 8. Preserve the warm ink
palette, chat typography and 44px controls. The header chevron hides secondary
navigation at every width; the same live status element moves below the title.
Its check timestamp returns when expanded. The composer gear independently hides
model, effort, permission, mode and alert settings. Attachment access stays beside
the input, and attached files, upload/delivery problems and active-turn controls
remain visible. Preferences persist per browser without rebuilding the conversation.

Mission Control hides its masthead only after its verified Pocket iframe reports
an active session with a restore control. Expanding the session restores the parent
navigation. Old clients and non-chat views retain the parent's own restore button.
Messages contain only visibility state; both sides check origin and source window.

Rendered phone and desktop scans preserve the existing native-font, compact type,
intentional title ellipsis, contained tables and slash-menu shadow exceptions.
Detector occlusion reports concern content outside the conversation scroll viewport;
that content remains reachable by scrolling. The clipped-container advisory is the
existing app shell. Compact controls retain 44px targets and readable contrast.

## Usage meters and main-pane close (1.7)

Pinned brief (design-studio to impeccable handoff): Operate, variance 3, motion 1,
density 8 - the same dials as 1.6/1.7's other refinements. Read: a utility meter/panel
addition to an existing tool, not a new surface; refine in place, don't redesign.

**Context meter.** A compact mono line next to the session state ("70k / 1M . 7%"),
reusing the ledger's ui-monospace treatment for numeric data. New `--warn` token
(#D9A94E, warm amber) added for the 70%+ state; `--err` marks 90%+. An "est." suffix
marks a value computed from a transcript tail rather than the CLI's own reported
window. Updates on session load and on each `usage` SSE event; native `title`
attribute carries the longer explanation rather than a registered tooltip, matching
the existing `#ctitle` pattern for plain (non-button) text.

**Plan-usage panel.** A sheet (the existing sheet/.opt component, not a new
primitive) reachable from the session's options menu (current session only) and from
App Settings, both natural per the surfaces listed in README.md's Housekeeping
section. Bars are a real labeled meter (percentage + reset time + "as of" text
alongside the fill), not a decorative sparkline - satisfies craft-floor's
content-stand-in ban because the data is genuine and fully labeled. One accent
(--clay) for normal usage, --warn/--err thresholds matching the context meter. Reset
times convert to America/New_York per the brief; values only refresh when a turn
runs, so the panel says so explicitly ("Only updates when a turn runs, not live.").

**Main-pane close.** Desktop (900px+, matching the existing .desk breakpoint) gets
an X in the main pane's header, visually identical to a split pane's existing Close.
Phone has no header room (chevron, title, search, options, collapse already fill it),
so Close lives in the session options menu instead, as the brief allows. Closing
reuses the existing session-options sheet() component for the "still running" choice
(Keep running / Stop) rather than inventing a new confirm dialog.

Detector run: `npx impeccable detect` against a rendered, authenticated snapshot of
both the chat view (context meter + close button) and the open plan-usage panel.
Zero findings on the chat view. One advisory on the usage panel - flat-type-hierarchy
(body/h1/h2/h3 all ~16px) - inherited from the app-wide .sheet h2 convention (13.5px
uppercase label, shared by every existing sheet: Settings, session options, rename,
skills); not introduced by this work and out of scope to change here without
redesigning every sheet's heading system.

Lead review after merge (2026-10-04): at 390px the counts in the context meter squeezed the
Sessions control to "Sessi…". Phones (≤600px) now show only the percentage, with the full
figure in the title and accessible name; values under 1% read `<1%` rather than `0%`; and
`#session-switch` takes twice the share of the status bar (all four controls had equal
`flex: 1`). Rendered detector scan of the 390/1440 conversation pages: 0 findings.


## UI/UX repair pass (1.7.1)

Pinned Operate refinement: variance 3, motion 2, density 8. The warm ink palette,
native typography, draft storage and persistent-session behavior are unchanged.

Split width budgeting includes the session rail, any workspace dock, 380px for
each conversation, and 5px for each visible divider. Excess panes hide in place
and return when space is available; their frames are never rebuilt or moved. A
desktop notice explains hidden panes. Divider values report actual rendered widths.

Settings opens before network or notification lookups. Each service owns its own
loading, error and retry state. Notification readiness has a bounded wait; version
failures cannot imply an up-to-date server. Settings destinations precede About
and What's new disclosures, which remain keyboard reachable inside the focus trap.
Replacement dialogs return focus to their original connected opener.

The session list exposes All, Active and Attention; a remembered Filters disclosure
contains Workspace, Agent, New, Pinned and Hidden. Applied secondary filters remain
visible in its summary with a Clear filters action. The desktop rail keeps its
existing independent disclosure.

Message toolbars show 44px previous/next scroll buttons only when contents exceed
the available width. Collapsing message settings hides the whole scroll wrapper;
attachments, draft and Send stay in place. Tab/pane X buttons close views only;
Close session process is a labelled Session options action on every screen size,
with the existing keep-running/stop choice when work is active.

Agent and workspace choices follow radio-group keyboard conventions. The rail
resize control, conversation controls, composer and workspace dock have named
landmarks, without nesting the main or banner landmarks. Skip links point to the
current view's real task/message field.

Verification: repository tests and the full Chromium browser suite pass, including
15 audit regressions, five axe scans without violations, and split transitions from
390px to 2560px. Rendered detector review retains the native-font, compact-hierarchy,
title-ellipsis, table/toolbar scroll containment and slash-menu-shadow exceptions.
Off-screen transcript paragraphs remain scroll-reachable; they are not inaccessible
content behind the composer. These checks do not certify physical-device IME,
OS push delivery, or assistive-technology behavior outside Chromium.

## Voice mode (1.8)

Pinned brief (design-studio to impeccable handoff): Operate, variance 3, motion 3, density 6;
warm ink identity unchanged. Read: a voice-control addition for developers using the existing
composer, calm utility language. The mic is a 46px outlined circle beside the clay Send, so Send
stays the single primary action; while listening it takes the clay-deep fill and clay ring. One
status strip above the composer carries every voice state in words (Listening, Release to send,
Transcribing, Speaking, Heard/Sent) with Cancel or Stop. A three-bar level meter shows the
microphone is hearing you; it is functional feedback, driven by input level with `transform`, and
keeps tracking input under reduced motion without easing. The ember stays the only ambient motion.
Settings → Voice reuses the existing toggle rows, native select and a text field, with 44px targets.
Rendered 390px scans of the listening strip and Voice settings have no detector findings on voice
elements; remaining findings are the documented existing exceptions.

Voice is labelled beta (1.8.2) in its Settings summary, the mic's accessible name and tooltip, and the
docs; the app version itself is not a pre-release. No visual change beyond the words.

Spoken alerts (1.9.0) add one native select to Voice (beta) and no visual elements; the existing strip shows
the one-time "tap anywhere" note when audio is still locked.

## Voice modes and contributed reading aids (1.10)

Pinned Operate refinement: variance 3, motion 2, density 6. The composer carries two
voice controls in the existing 46px round style: the mic (one message, tap or hold) and
a drawn headset (hands-free conversation). Only the active control shows the clay-deep
pressed state, and the strip names the mode ("Hands-free. Listening…") with an End or
Cancel action. Hands-free is session-scoped and starts only from the headset; every
announcement is one-way. The headset steps aside while a typed draft is present, which
keeps the 360px composer's text field at its previous width.

Tool ledgers fold behind a one-line mono summary (count · latest call), so a turn reads
prose / fold / prose. The accent may be swapped per browser (Orange default, Blue,
Purple) by overriding `--clay` / `--clay-deep` only; nothing else in the palette moves.
Pinned sessions lead each group with a 2px accent rule. Rendered 360/390/1440 browser
screenshots and axe scans reviewed; source detector clean.

## Reply suggestions (1.11)

Pinned Operate refinement: variance 3, motion 2, density 6. Suggested replies sit under
the latest finished reply as 10px-radius buttons in your-side material (clay-deep fill,
clay hairline, primary text), so a tap reads as "send this as my message". 44px targets,
wrap on phones, a dim 44px X to dismiss that returns focus to the message box. They
appear only when nothing is running, nothing is pending and the box is empty; no motion
beyond the existing message entrance. Rendered 390px screenshot and axe scan reviewed.

**Recommended pick (1.17).** Pinned refinement: variance 3, motion 1, density 5. The option the agent
marks "(Recommended)" uses the app's primary-action material (clay fill, ink text, like Send) with a
12px "Recommended" tag beneath the label in the same ink, so it reads at a glance and is announced by
name. The other buttons are unchanged; nothing new moves. Ink on the clay fill measures 6.0:1 (computed
2026-10-06); the tag's .9 opacity keeps it above 5:1.

## Phone composer rows and Attention (1.12)

Up to 600px (phones and narrow split panes) the message box takes a full-width row and the
controls sit beneath it: settings left, voice controls and Send right, Steer now / After this
turn filling the space while a turn runs. Costs about 50px of reading height on phones in
exchange for a box that never collapses (it fell to "Stee…" in a 480px pane). Targets stay 44px.
Attention counts unopened Response ready replies with questions, approvals and failures.

## Context ring and hands-free confirmation (1.13)

Pinned Operate refinement: variance 3, motion 1, density 6. The state-bar text meter is
replaced by a 22px ring in a 44px button beside the composer's settings button (in the
working row while a turn runs): a dim track, a clay arc for the share used, amber at 70%,
red at 90%. The tooltip gives model · used of window (percent); the accessible name says
the same. A click opens a "Usage" sheet: this session's context (bar, window / used / free,
as-of, estimate note) above the provider's plan windows. The arc is the only change of state.
In hands-free the strip reads the instruction back ("Send this? …") with Send (clay outline),
Edit and Cancel at 44px. Rendered desktop/phone screenshots and axe scans reviewed.

## Mark as reviewed (1.15)

Pinned Operate refinement: variance 2, motion 0, density 6. Clearing Response ready without
opening a session reuses existing surfaces: a "Mark as reviewed" row (tick icon) at the top of
Session options when the session has an unopened reply or failed turn, and in Attention / New a
surface-toned bar above the groups — dim count left, a 44px chip right — that turns into
"Marked N as reviewed · Undo" for 10 seconds. No new colour, no motion; the status line is a
live region and focus moves to Undo. Rendered 390px screenshots reviewed. Reviewed state is
shared by all devices (server-kept markers); no visual change for that.

## Subagent activity (1.16)

Pinned Operate brief: variance 3, motion 1, density 7. Preserve the warm ink palette,
native type and existing sheets. A 44px text button appears below conversation
controls only when agents are recorded; it stays available with the header collapsed.
Session options always offers the sheet, including its empty state. Each disclosure row
names the agent and text status, then shows task, latest activity, available model and
usage. The sheet has 16px side padding; escaped provider text wraps within phone and
split-pane widths. Five-second refreshes retain open rows and focus. Failed or stale
checks say the status is unconfirmed and offer Retry. The sheet traps focus, closes
with Escape and returns focus to its opener.

Rendered phone and desktop screenshots reviewed. Verification: 80 repository tests,
39 browser regressions and 13 axe scans passed. The rendered detector found no new
Subagents issue; inherited findings concern app clipping, native font, type hierarchy,
title ellipses, compact navigation and the hidden slash-menu shadow. An independent
review found a backend replay-status bug; it was fixed with targeted tests and independently
reverified. Final review verdict: Pass. These browser checks do not certify a physical device or a
split-specific screenshot.

## Pinned tabs, pin order and voice mute (1.18)

Pinned Operate brief: variance 3, motion 1, density 7. Keep the warm ink palette, native
type and existing chrome. A pinned open-session tab reuses the rail's marks exactly: the
13px pin glyph and the clay title (6.0:1 on surface, 5.4:1 on the raised current tab),
with a visually hidden "Pinned:" prefix for screen readers. Nothing else on the tab strip
changes. Pinned rows gain a 44px grip (six-dot glyph, faint) before the options button on
desktop widths only; it drags with pointer events (touch-action none), answers the arrow
keys, and the drop target shows a 2px inset clay rule above or below. Session options adds
Move pin up / down with the existing arrow glyphs for phones and keyboards. The voice mute
is one control in two places: a chip beside Alerts in the idle composer and a bell-sized
icon in the working row, speaker and speaker-off glyphs in the authored 1.8px stroke, set
state in clay like the other set chips. It appears only when the server has voice.

## UI/UX audit fixes (1.19)

Pinned Operate refinement from the 2026-10-08 audit: variance 3, motion 1, density 6. Warm ink
palette, native type and every existing control unchanged; this pass is measure, quieter chrome
and clearer state.

Prose in a reply (paragraphs, lists, quotes, headings) stops at 68ch from 700px up; tables, code,
tool folds and the composer keep the 1280px frame, and the user's chip stops at 60ch. ch follows the
Chat text size setting. At 1440px a paragraph measured 127 characters per line before; the browser
regression now asserts 80 or fewer.

Up to 600px the run status joins the title bar's second line after the project name and a faint
middot, in short words (Idle, Running, Unconfirmed); the strip above the conversation is gone there,
returning 28px to reading. Wider screens keep the strip with its full wording. The check age moves
in 10-second and minute steps, so the ember stays the only thing that moves while nothing changes.

Scheduled runs sit in a closed `<details>` group at the end of All: the same group heading with a
drawn disclosure triangle (the tool-fold glyphs) and a dim "Scheduled runs" note; rows inside are
ordinary rows. A failed last turn ends the conversation with a hairline `--err` card: the reason in
`--err` (5.6:1 on the page) and two 44px chips in primary text. Session options gain hairline
separators between four groups; Chat text size moves into the last one. The New session hint under
Start uses `--err` at 14px, beside the action it explains.

Rendered phone and desktop scans: 20 axe scans clean; detector findings on the new views are the
documented exceptions (app-shell clip, title ellipsis, native font, compact hierarchy, slash-menu
shadow, off-screen rows under the sticky header). The one new finding, the failure card's buttons
under the composer, was fixed by scrolling it into view when you are reading at the end.

## Session title settings (1.20)

Pinned Operate refinement: variance 2, motion 0, density 6. One existing toggle row (dot, title, sub line)
directly under Sync names with code-server, then the Voice settings' native select ("Title model") indented
to the row text (50px) with a dim 13px status note. The sub line states the live situation in words (Off /
On, using Claude · Haiku / On, but nothing can make titles); unavailable providers stay listed but disabled
with "(unavailable)", and the note gives the reason. No new colour, icon or motion. The select is disabled
while titles are off. 44px targets; rendered phone screenshot and axe scan reviewed.

## Audit polish (1.20.1)

Pinned Operate refinement: variance 2, motion 0, density 6. A soft mask fades the message-settings row at a
scrolling edge instead of cutting a word; phone permission chip says Full / Review. The context ring track is
dotted (a gauge, not a radio). Rows in the default workspace drop "~ ·". Copy and toolbar arrows reach 44px.
Suggested-reply options wrap in their own group so the dismiss X stays on the first line.

## While you were away (1.21)

Pinned Operate refinement: variance 2, motion 1, density 6. The divider is the pin-divider's language at
reading size: a 1px clay hairline either side of a 13px/600 clay label ("New since 8:40 PM"), so "new" uses
the one accent the app already reserves for active markers. The summary card is an existing surface (surface
fill, hairline, 14px radius, 16px padding) with a 13px dim label, 15px text as a short list and a 12.5px dim
source line that names the model and points back to the messages; on wide screens it keeps the 68ch prose
measure. It enters with the existing 180ms rise; nothing else moves. The view anchors at the divider until
the first scroll, tap, key or send. Rendered phone/desktop screenshots and axe scans clean; detector findings
are the documented exceptions.

## While you were away at the end (1.25)

Pinned Operate refinement: variance 2, motion 1, density 6. The divider stays where it was; the summary card
moves to the end of the conversation, under the latest message and above its suggested replies, and its
label becomes the divider's own clay 13px/600 "New since 8:40 PM" line, so the one accent still means
"new to you" and the card reads as the divider's echo rather than a second voice. The only new control is
a 13px/600 dim text button, Read from there, on the label's right (36px tall, raised fill on hover), in the
session-switch language. The view opens at the end and holds there while the page settles; Read from there
hands the hold to the divider. No new colour, no new motion; the card keeps the existing 180ms rise.

## Search inside conversations (1.22)

Pinned Operate refinement: variance 2, motion 0, density 6. No new control: the existing session search box
also searches inside conversations. Results are a session group ("In conversations" + count) after the title
matches, in the session-row language: title, workspace · agent · age, then a three-line snippet in dim 14px with
the speaker in primary 600 ("You:", "Claude:", "Codex:", "Related:") and matched words in the find-highlight
mark. A 13px dim note states the scope honestly (MemStem: every conversation by wording and meaning; Pocket:
exact phrase in N recent conversations). Loading, empty and failure are plain lines; failure adds a Try again chip.

## Saved prompts (1.23)

Pinned Operate refinement: variance 2, motion 0, density 5. Saved prompts are the existing 44px chips in a
wrapping row between the task heading and the box; the applied chip takes the set-chip treatment (clay text,
clay border, clay-deep fill) and a dashed, dim "Manage" chip ends the row. Recent is a closed disclosure with
bordered rows like the project list (two-line text, 12.5px dim meta). Save and Manage are ordinary sheets:
name field, a dim summary of what will be set, the existing toggle row, one primary button; Manage rows carry
44px Up/Down icons and Edit/Delete chips, with Delete turning red and asking once more. No new colour or motion.

## Message times (1.24)

Pinned Operate refinement: variance 3, motion 1, density 6. Times are data, so they take the ledger's
mono voice at 12px: a reply carries its time on a line above the prose in `--dim` (6.9:1), and your own
message carries it on a line at the bottom-right inside the chip, tinted from the chip's own hue
(`color-mix` of the chip text and `--clay-deep`, about 6.5:1), never gray. The day divider is the quiet
sibling of the clay "New since" line: 12.5px `--dim` label between 1px `--line` rules, so the one
accent still means "new to you". Times are rendered from a `data-time` attribute by the stylesheet,
so Copy message, Find in conversation and the find marks never touch them. Settings adds one toggle row
in the existing style. No new colour, no motion.

1.24.1: a bubble from another day carries its date in the same 12px mono line ("Yesterday 3:05 PM",
"Oct 6, 3:05 PM"); today's keep the time alone, so the common case stays as quiet as before.

## Working in background (1.64)

Pinned Operate refinement (design-studio → impeccable): variance 3, motion 1, density 6;
existing tokens, no new colour. Read: a session whose reply ended while a background job or a
subagent still runs must look alive without claiming the agent is mid-reply. Running keeps the
clay ember and means "wait"; the new state reuses the same ember in `--dim` with a 2.6 s breath
(`.ember.dim`) and means "you may send, the session will wake on its own". It appears in the
session row (own group under Running, label `Working in background · 1 job`, detail line naming
the first job), the title bar lamp when the composer is free, and the open-session tabs at 7px.
Status text stays `--text`; the status bar shows `Background` in short form. No new motion.

**Side chat (1.78).** Pinned refinement: variance 3, motion 2, density 4. The dock's fourth panel (420px) on a
window at least 1280px wide, otherwise a tall sheet (full height on a phone, a 640px dialog on a desktop). It
reuses the conversation's own parts: `.m-user` bubbles, `.m-asst` documents with tool folds, the composer and the
clay `.primary` (**Ask**, which reads **Stop** in `--err` on `--raised` while an answer streams). The model and
running cost sit in the `.turnmeta` voice beside a **New side chat** chip. No new colours, type or motion.
1.78.2: on a desktop (≥900px) the opener is a **Side chat** chip leading the conversation chips (Side chat,
Project, Add task) under the message box, an icon in the Working row, `set` and `aria-pressed` while open; the
header's speech-bubble icon is phone-only, where the chip row scrolls.

**Side chat and Branch (1.79).** Pinned refinement: variance 3, motion 2, density 4. Two offshoots, kept apart by
name, icon and one shared sentence each (`SIDE_WHAT`, `BRANCH_WHAT` in sidechat.js) used in the chips' hover text,
Conversation options' sub-lines, the panel and the sheet: Side chat (speech bubble) asks without saving; Branch (a
fork glyph in the same 2px stroke) starts a saved conversation that can work. Each surface links to the other: the
side chat's help line ends in a clay text link, **Need work done? Branch instead**; the Branch sheet ends with a
hairline and **Use side chat instead** as a chip. The Branch sheet is a standard sheet: help line, a `--warn` line
only when the parent is working in the same folder, a labelled `queue-editor`, the settings it will use, the clay
**Start branch**. A branch's `.lineage` line sits at the top of the conversation controls in `--dim` 13.5px with
clay links: **Branch of …** on a branch, the first three branches on its parent. List rows add `· Branch` to the
provider label. No new colours, type or motion.

## Handoff card (1.96)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 7; existing tokens, no new colour. Read:
a reply offers to move the work to a fresh conversation, and the person decides in one look. `.handoff-card` is a sibling of
the file cards: `--surface`, `--line`, 12px radius, 640px at most, no side stripe. The head line is `--dim` beside the hand
(Lucide hand-helping, side-on; a raised palm reads as stop). Title `--text` semibold, then a `--dim` line with folder, agent
and permissions, then three lines of the briefing. **Start** is the one `--clay` `.primary`; **Review first** is a chip. Both
are 44px tall. A started card collapses to its head line with a link, an expired one to a sentence. A missing folder turns
Start off and adds a `--dim` note; nothing is `--warn` because nothing is wrong yet. The card is `role="group"`, not a
landmark, because a reply can hold two. No motion.

## Git panel folders (1.97)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 7; existing tokens, no new colour. Read:
the panel has to say which repository it is showing before anything else, because that is the question it was failing to
answer. The `h2` carries it: `Working in <folder> · <branch>`, wrapping anywhere so a long branch stays on the phone. A native
`select` in `.git-pick` appears only with two or more repositories (44px, `--surface`, `--line`), because a phone already has
the right control for this. `.git-also` is one `--dim` line with plain links. No `--warn`: two conversations in a folder is
worth knowing, not a fault. The Branch sheet adds `Starts in <folder>.` to its existing note. No motion.

## Worktrees (1.98)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 7; existing tokens, no new colour. Read:
the person is clearing old folders and wants to know what's safe in one look, so the groups carry the answer and each row
says why in plain words. `.git-trees` follows the changed files in the panel's own flow, with no card around it. Groups are
native `details`, open from 700px and closed on a phone with their counts showing, 44px rows. A row is name (semibold), then
`--dim` branch, date and reason; hairline `--line` between rows. **Remove** is a chip and only exists on a Ready row, so the
list has no destructive `--clay`. The confirm sheet `.git-remove` is the one place with `--clay` (**Remove folder**) and the
one place with `--warn`, on the line that names ignored files, because that is what's lost. **Keep it** is a chip. No motion:
groups fill in without animating.

## Coordination (1.99)

Pinned Operate refinement (design-studio → impeccable): variance 2, motion 1, density 7; existing tokens, no new colour. Read:
the person glances here to see whether something is in the way, and a stale claim is the only thing they act on. `#/coordination`
opens like Tasks, with no card around anything. `.coord-row` is a hairline row: from 700px, name (semibold), conversation link,
reason, age in the ledger mono and **Release**, with the waiting line under the conversation; on a phone the same parts stack
and the age stays beside the name. **Release** is a plain chip, not `--clay`: it's one tap, and the holder is only told, so the
view has no primary action and no `--warn`. A clash is never shown here, because the agent hits it. **Recent** uses the same
columns, with the empty action column kept so times line up. `Terminal session` is plain text, so an unverified holder has no
link. `.session-held` is one `--dim` underlined line above the list, only while something is held; a quiet day looks exactly
as it did. No badge, counter or motion: rows change when the 10-second check changes the words. Focus stays on a Release
button across a repaint. Assistant mode shows none of it.
