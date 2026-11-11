<!-- manual
checked: 1.103.0
sources: public/split.js, public/workspace.js, public/tips.js, public/sidechat.js, docs/session-focus.md
-->
# Desktop and phone

Pocket Code is one web app that lays itself out for the screen it is on. On a computer it is a
workspace: a conversation rail, tabs, up to four conversations side by side and a panel for results,
the queue, Git and side chat. On a phone the same tools open full screen and as sheets, with the
message box and Send always in reach. There is nothing to turn on; this page explains what changes
with the width and how to move around.

The breakpoints, by window width:

| Width | Layout |
|---|---|
| Under 900 px (phones, narrow windows) | One column. No rail, tabs or split view; panels open as sheets. |
| 900 px and wider | The rail, open-conversation tabs and split view. Enter sends. |
| 1280 px and wider | Results, Queue, Git and Side chat open in a panel at the right instead of a sheet. |

## Use it on a desktop

### The rail

The rail on the left lists your conversations (see [Conversations](sessions.md#find-a-conversation)).
Its head holds:

- A switch between **Chats** and, when they are turned on, **Projects**, **Files**, **Tasks**,
  **Vault** and **Inbox**. The pressed entry is what the rail lists; a bar marks the entry the main
  area is showing, so a file opened in a tab is marked while the rail still lists chats. With five or
  more entries, each shows its icon over its name while the rail is at least 300 px wide; on a
  narrower rail only the pressed entry shows its name. **Projects**, **Tasks**, **Vault** and
  **Inbox** carry a count (due reminders and tasks, Vault requests waiting, unread Inbox items) on
  every view.
- **Filters**, which folds the conversation filters away (the applied ones stay named, with **Clear
  filters**).
- **App settings** (the cog) and **New conversation** (the **+**).

Drag the divider beside the rail to resize it between 220 and 480 px, or focus the divider and press
Left or Right (20 px a step). The panel icon beside a conversation's title (**Show or hide the
conversation list**) hides the rail; the tabs stay. Both choices are saved on this browser.

### Tabs

Each conversation you open gets a tab above it. Pinned conversations come first, in their pinned order,
with the pin and the highlight colour; the rest follow in the order you opened them. This browser keeps
the 12 most recent tabs, and other Pocket windows of the same browser see the same tabs. Projects,
files, tasks, the Vault and the Inbox can be tabs too.

A mark before the title shows the conversation's state, matching its rail row:

| Mark | Meaning |
|---|---|
| Breathing ember | A reply is running |
| Dim ember | Working in background |
| Amber dot | Needs you: a question or approval |
| Green dot | A reply you have not opened |
| Red dot | The last reply failed |
| Ring | Activity elsewhere, or waiting (a paused queue, a usage reset) |
| Hourglass | A large prompt cache is about to expire |
| Snowflake | A large prompt cache has expired; the next reply writes it again |

Hover a tab to read its state. Alt [ and Alt ] move to the previous and next tab. The X on a tab closes
the tab only; the conversation and any running work continue. Closing the tab you are on opens a new conversation, as the
plus does, rather than another tab, so a conversation waiting in Attention stays there until you choose to open it.

### Split view

**Split view** (the columns button in the conversation header) opens **Open beside**, a picker grouped
into **New and libraries**, **Conversations**, **Projects** and **Files**, most recent first. Type in
**Find a conversation, project or file** to search further. **Conversation options → Open beside**
opens another conversation next to the one you are reading.

- Up to four conversations show at once, the main one included. Only one unstarted New conversation
  pane can wait at a time.
- Each pane is a complete Pocket window: its own conversation, message box, draft, stream and dialogs.
- In a pane's header, the swap button (**Make this the main conversation. The two swap places.**)
  exchanges it with the main conversation, and the X (**Close this pane. The conversation keeps
  running.**) closes the view.
- Drag a divider, or focus it and press Left or Right (40 px a step), to resize. Double-click a divider
  to share the space equally again.
- Each conversation needs at least 380 px beside the rail, the panel and the dividers. Panes that do not
  fit hide in place, with a note: *1 pane is hidden at this width. Widen the window or hide the
  conversation list to restore split view.* They return when there is room. Below 900 px every pane
  hides. Hiding never reloads a pane, loses its draft or stops its work.

The arrangement is saved on this browser and comes back after a reload. Settings that open projects,
files and links **Beside the conversation** open them in a new pane; from inside a pane, the new pane
goes to its left.

### The panel: Results, Queue, Git and Side chat

The conversation header has **Results**, **Queue** and **Git**. At 1280 px and wider they open in a
panel at the right with tabs **Results**, **Queue**, **Git** and **Side chat**; below that width each
opens as a sheet. The panel you leave open is remembered on this browser and opens again with the next
conversation. Close it with its X (**Close workspace panel**), or Escape while the focus is inside it.
If the window narrows below 1280 px, the open panel turns into a sheet and keeps what you typed.

| Panel | What it shows |
|---|---|
| **Results & links** | Reports, files and links shared in the conversation, with **Find a result** and **Refresh**. |
| **Queued instructions** | Messages saved to run after the current reply, each as its own reply ([the queue](conversation.md#manage-the-queue)). Stopping the reply pauses the queue. |
| **Git workspace** | Read only: the branch, the changed files (the first 250) and a **Working tree** or **Staged** diff for each. [Worktrees](conversation.md#see-and-remove-worktrees) sit below the files. Hidden when the workspace is not a Git repository. |
| **Side chat** | A private question about the conversation that adds nothing to it ([side chat](conversation.md#ask-a-side-question-side-chat)). On a desktop it also opens from the **Side chat** chip above the message box, or Ctrl/⌘ ;. |

### Close views and processes

| Control | What happens |
|---|---|
| X on a tab | Removes the tab. The conversation and its work continue. |
| X on a conversation pane | Closes the view. The conversation continues on the server. |
| X on an unstarted New conversation pane | Discards that pane's draft, attachments, choices and retry state. |
| **Conversation options → Close conversation process** | Ends the main conversation's server process. If a reply or background job is running, choose **Keep it running in the background** or **Stop the reply**. The first pane becomes the main view (bringing a New conversation pane's draft with it), else New conversation opens. |
| **Stop** while a reply runs | Interrupts the reply and pauses the follow-up queue. |

No control deletes a conversation. Closing a browser or a tab leaves the work running.

### A view in its own window

Projects, files and links can open **In a new browser window** (Settings → Projects, files, tasks &
vault). That window shows the one view, without the rail, tabs or panes.

## Use it on a phone

Below 900 px Pocket shows one thing at a time.

- **Home** is the conversation list (in Assistant mode, the message box). Its header has the bell
  (**Toggle notifications for this device**) and Settings; **Your conversations** has chips to the
  Projects, Files, Tasks, Vault and Inbox libraries that are on, with their counts (**Tasks · 2 due**,
  **Vault · 1 waiting**, **Inbox · 3 new**), and **Refresh**. The round **+** starts
  a conversation.
- **In a conversation** the header has Back, the title (tap it for **Conversation options**), the
  speech bubble for **Side chat**, **Find in conversation**, **⋯** and the header chevron. A second line
  holds **Conversations** (a sheet to switch), **Results**, **Queue** and **Git**, each opening as a
  sheet. **Changed files** is in Conversation options on a phone.
- **Long-press** a conversation row for its options, or a saved prompt chip to manage saved prompts.
- **The message box** keeps the paperclip, the context ring and Send beside the text. Enter adds a
  line; tap Send to send. When the chips above the box do not fit, arrow buttons (**Previous message
  settings**, **More message settings**) scroll them. The page follows the on-screen keyboard so the box
  stays visible.
- **Drafts and attachments** are kept on the device for each conversation, through reloads and app
  switches.

Pocket can be installed to the home screen as an app (see
[Put it on your phone](getting-started.md#put-it-on-your-phone)). The count of due tasks and reminders on the
app icon works only in the installed app.

## Collapse controls for more room

These work at every width and are saved on this browser:

- **The header chevron** (**Collapse conversation header** / **Expand conversation header**). Collapsed,
  the header keeps the title, a short run status, the options and the chevron; the Subagents button and
  question and approval banners below it stay too. It hides the project name, the tabs,
  **Conversations**, **Results**, **Queue**, **Git**, **Find**, **Changed files** and the age of the last
  status check. Ctrl/⌘ F still opens Find. When Pocket is embedded in another page that allows it
  (`POCKET_FRAME_ANCESTORS`), the page around it is told so it can fold its own header too.
- **The sliders button beside the message box** (**Hide message settings** / **Show message
  settings**). It hides the chip row: model, effort, permissions, Codex mode, **Alerts**, voice,
  **Side chat**, **Branch**, **Handoff**, the project chip and **Add task**. The paperclip, the context ring and Send
  stay, and so do attachments, upload problems, Stop, the steering choice and agent requests.
- **Filters** on the rail and on the conversation list fold the filters behind a summary line.
- **Settings → Conversation → Collapse steps** folds each run of agent steps behind a one-line summary.

Assistant mode (**Settings → Appearance → Mode**) hides the developer controls altogether: the chips,
Results, Queue, Git, split view and the cost line.

## Move around

- **Back** in a conversation returns to the conversation list (on a desktop the rail is there instead,
  so there is no Back). Escape does the same when no dialog, find bar or panel has the focus.
- **Back from a project, a file or a linked page** returns to where you opened it from: the
  conversation, Files with its filters and scroll position, Projects or Scheduled. The button says
  where (**Back to conversation**, **Back to Files**, **Back to Projects**, **Back to Scheduled**). Opened
  from a direct link, Back goes to its library. The browser's own Back and Forward follow the same path.
- **Returning to a view** restores its scroll position and which sections were open. A conversation
  reopens where you were reading.
- **Dialogs and sheets** keep the keyboard focus inside them, close with Escape or the X, and return the
  focus to the control that opened them. A page opened from Settings has **Back to Settings**; a
  Settings category has **All settings**.
- **A library that fails to load** says so with **Retry**, keeping the last loaded list on screen when
  there is one. A library that is turned off says *Projects is off. Turn it on in Settings → Projects,
  files, tasks & vault.* with **Open Settings** (for Files, Tasks and the others alike). In Assistant mode
  it says *Settings → Features* and **Open Settings** goes there; when Assistant mode is locked it says
  *Ask the person who runs this install to turn it on.* and has no button.

## Keyboard shortcuts

| Keys | Where | Action |
|---|---|---|
| Ctrl/⌘ K | Anywhere with a message box or the conversation list | Find a conversation (**Switch conversation**) |
| Ctrl/⌘ Shift L | Same | New conversation |
| Alt [ / Alt ] | With a conversation or view open | Previous / next tab |
| Ctrl/⌘ F | In a conversation | Find in conversation |
| Ctrl/⌘ ; | In a conversation | Open or close its side chat |
| Enter | Message box, New conversation, side chat (900 px and wider) | Send or start |
| Shift+Enter | Same | New line |
| Enter / Shift+Enter | Find in conversation | Next / previous match |
| Enter | Rename, saved prompt name | Save |
| Escape | Anywhere | Close the open dialog, the find bar or (with the focus in it) the panel; from a conversation, back to the list |
| Left / Right | Rail or pane divider | Resize |
| Up / Down | A pinned conversation's grip | Move the pin |
| Arrows, Home, End | Agent and workspace choices, the rail's Chats/Projects/Files switch | Move the selection |
| Tab | In a dialog | Cycles inside the dialog |
| Tab | First key on a page | Shows a skip link (**Skip to message**, **Skip to files**, …) that jumps past the rail |

On a phone, Enter in the message box adds a line. **Settings → Help & updates → Keyboard & workspace**
shows the main shortcuts in the app.

## Tooltips

With a mouse, resting on an icon button for a moment shows what it does; with the keyboard, tabbing to
it does the same. Touch screens never show them. Buttons with a visible label have none. Escape,
scrolling or a click hides the tooltip.

## Text size

**Chat text size** is in **Conversation options** and **Settings → Appearance**: **Smaller**,
**Larger** and **Reset**, from 14 to 24 px (17 by default). It applies to every conversation on this
browser and keeps your reading position while it changes.

## Notifications on a phone and a computer

The settings themselves are described in [Settings](settings.md#notifications--voice). Each browser
decides for itself. A phone and a computer signed in to the same Pocket each turn push on
or off and choose what they get:

- **Turn it on** with the bell on the conversation list or **Settings → Notifications & voice → Push to
  this device**, then allow notifications when the browser asks. Notifications then reach the device
  even when Pocket is closed.
- **Choose what this device gets**: **Finished replies**, **Due tasks and reminders**, **Vault
  requests** and **Inbox alerts**. Finished replies are sent at normal priority; the others are urgent,
  so an idle Android phone shows them at once.
- **Count on the app icon** shows how many tasks and reminders are due, on the installed app's icon.
- **Completion chime** plays a short sound when a reply finishes on screen, on this device.
- The **Alerts** chip above the message box (it reads **Muted** while muted) mutes or unmutes one conversation's
  notifications on every device.

A finished-reply notification is titled with the conversation and says what happened: **Ready ·
$0.07 · 14s** (cost and time; only **Ready** in Assistant mode and for Codex), **Something went
wrong. Tap to see what happened**, **Stopped**, or **Usage limit reached. Picks up again at …**.
Tapping it opens the conversation.

A conversation that is open in a browser when its reply finishes sends no push; the chime plays there
instead. A reply you stopped sends none either. A Claude reply that leaves background jobs running holds its push; the
notification comes when the agent reports back after those jobs. A reply that hands straight over to
a queued message sends no push; the last reply of the queue does.

Push needs the server's `VAPID_PUBLIC` and `VAPID_PRIVATE` keys and an HTTPS address; without the keys,
turning it on says *Push not configured on server*.

## How it works

Everything on this page is stored in the browser, not on the server: tabs, the split arrangement and
pane widths, the rail's width and whether it shows, which panel is open, the collapsed header, message
settings and filters, text size, drafts and reading positions. Clearing the browser's storage resets
them; another device keeps its own. Each split pane is the same app in a frame (`/?pane=<id>`); a view in
its own window is `/?solo=1`. Pins and their order, names and per-conversation mutes are on the server
and the same everywhere.

## For agents

Layout, tabs, panes and shortcuts are the user's own controls; there is no command for them. Explain
them with the labels on this page. To send the user somewhere, give a Pocket link: `/#/chat/<id>` for a
conversation, `/#/new` for New conversation, `/#/start/<id>` for a briefed start (see
[start links](sessions.md#start-links)). Do not turn on notifications or change Settings for the user;
both are per device and need the user's browser.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No Split view button, rail or tabs | The window is under 900 px wide, or Assistant mode is on. | Widen the window, or switch to Developer mode in **Settings → Appearance → Mode**. |
| *Not enough room for another pane.* | The window cannot fit another 380 px conversation. | Hide the conversation list, close a pane or widen the window. |
| *Split view holds up to four conversations. Close a pane first.* | Four conversations already show. | Close a pane. |
| *N panes are hidden at this width.* | The window narrowed or the rail grew. | Widen the window or hide the conversation list; the panes come back as they were. |
| Results, Queue or Git open as a sheet on a computer | The window is under 1280 px wide. | Widen it to get the side panel. |
| No **Git** button | The workspace is not a Git repository. | None needed. |
| *Notifications blocked. Allow notifications in this site's browser settings.* | The browser's permission was refused. | Allow notifications for the site in the browser's settings, then turn push on again. |
| *Push not configured on server* | The server has no VAPID keys. | Set `VAPID_PUBLIC` and `VAPID_PRIVATE` and restart Pocket. |
| *Notifications unavailable. Reload the app and try again.* | The app's service worker is not ready. | Reload the page or the installed app. |
| Tabs or panes are gone on another device | They are kept per browser. | Open the conversations there; pins and names are shared. |
