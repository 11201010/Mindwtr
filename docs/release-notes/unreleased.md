# Mindwtr Unreleased

Changes collected since the latest stable release.

## Full Change List

### Tasks, projects, Focus, and review

- When you convert a task to a project, you can turn its checklist into project tasks. Each item becomes a task that keeps its order and checked state, and you can undo the conversion. (#1355)
- Quick add accepts a time estimate, such as `/estimate:45m` or `/estimate:1h30m` (`/duration:` also works). The syntax is hidden and ignored while time estimates are turned off. (#1358)
- Copy a task link or a task ID from the task menu on desktop and mobile. Opening a `mindwtr://open?task=…` link shows the task, or a notice when the task is not on this device. (#1368)
- A strict daily repeat with only a start date catches up to today when you complete it several days late. The next-date preview now matches the task that completion creates. (#1366)
- Overdue colors and task age in task rows refresh as time passes, on desktop and mobile. (#1360)
- Process Inbox keeps a priority, energy level, or person typed into the title (`/priority`, `/energy`, `%Person`) when that field is hidden.
- On desktop, filing a task to Someday from Process Inbox clears an overdue review date, as mobile already did.
- Search no longer sends negated words (`-word`) to full-text search, so excluded words stop bringing tasks back into the results.
- On mobile, a finished Pomodoro focus session adds its time to the linked task once, even if the app stops right after the session ends.
- On mobile, Waiting For drops selected tasks that become hidden, so bulk actions only change tasks you can see.
- On mobile, the project next-action prompt follows your quick-add settings, such as fields you turned off.
- The desktop project view groups reference tasks by section.
- On desktop, a monthly repeat on a weekday (for example, the second Tuesday) shows as Custom in the editor, as on mobile.
- The desktop Convert to section dialog stays responsive in large libraries.

### Desktop views and organizing

- Desktop Timeline can filter by task status and show completed work. Archived completed tasks open as read-only history. (#1357)
- In desktop Timeline, drag a bar to move a task's or project's dates, or drag one end to change only the start or due date. Keyboard edits work too, and Undo restores the old dates. (#1361)
- Desktop bulk organize suggests existing contexts and tags as you type and keeps labels that contain spaces. (#1344)
- In desktop Contexts, drag a task onto a context to add that context, with Undo. In Projects, dragging a task over a project or area shows Move to, and the move is confirmed only after it is saved. (#1345)
- Desktop Daily Review and Weekly Review leave out events from calendars you have hidden.
- The desktop Calendar month view refuses a drag that would put a task's start after its due date.
- Desktop Obsidian import can require an inline task tag, like the Tasks plugin global filter. Only tasks with that tag are imported, and new inline tasks get the tag automatically. (#1351)

### Calendars and reminders

- A repeating reminder replaces the task's earlier notification instead of adding a new one each time, on Android, iOS, and desktop. On Android, Snooze and Done work while the app is in the background, and Done stops the task's next repeat. (#1346, #1348)
- Android sets reminders again after the phone restarts. (#1360)
- Mobile reminders are more reliable. A task added while the app starts gets its reminder. Two reminders set for the same minute both ring. One refused alarm no longer stops the others. Repeating reminders are set again after a time zone change.
- On iOS, date pickers show a month calendar instead of a spinning wheel.
- On iOS, removing Mindwtr's device calendar finishes after an interrupted attempt instead of staying stuck.
- External calendar feeds larger than 20 MB are refused instead of loading without a limit.
- On mobile, screen readers announce the calendar Area choices cleanly. (#1305)

### Capture, Apple Watch, and mobile

- Apple Watch shows a Focus task's description and checklist, and you can check off checklist items on the Watch. (#1354)
- iOS sends updates to the Apple Watch only when the Watch's data changes, including when a review comes due.
- On Android, the task preview keeps its last field above the navigation bar. (#1343)
- On Android, turning off the persistent capture notification removes it, even if the app stopped before it could.
- The mobile feedback form refuses an email address over 254 characters before Send and keeps a bug report within the 4,000-character limit. A send that finishes after you reopen the form no longer clears your new draft.
- Android installs from a Google Play testing track check Google Play for updates, not GitHub.

### Sync, encryption, and privacy

- Archive retention now waits until this device has synced in the current session. It also waits while the selected sync backend is disconnected. An old archived copy can no longer remove a task that another device restored or edited.
- Desktop sync uploads attachment files only from Mindwtr's attachment folders, so a shared sync folder cannot make it upload other files from the computer.
- Desktop refuses to start a WebDAV encryption change on a server without strong ETags, with a clear message, before anything changes. Desktop encryption now runs through the same engine as mobile.
- Mobile sync encryption setup is safer. Dropbox setup checks the new Dropbox folder for encrypted data, not the saved location. Switching to a clean folder works when the current folder is partly encrypted. A setup check that finishes after you chose Off no longer turns sync back on. Off is refused while an encryption change is unfinished, so the location stays saved for Retry. After Recheck, a location that another device encrypted is found and unlocked instead of blocked again.
- Mobile attachment sync recovers in more cases. A partly encrypted folder seen once no longer delays attachment sync for every other location. Sync finishes an attachment download left from an earlier run, even when nothing else changed. A device with many removed attachments finishes cleanup and goes back to skipping unchanged data.
- Mobile WebDAV sync resolves links in folder listings against the server address. This fixes the "Unmatched Href" error on servers such as Synology. (#1342)
- Desktop File Sync on Linux can copy attachments into the sync folder again ("path refused by fs scope"). (#1356)
- Self-hosted Cloud gives the sync document its own 50 MB body limit (`MINDWTR_CLOUD_MAX_DATA_BODY_BYTES`), separate from the limit for small requests. When a server or proxy refuses a sync write as too large (HTTP 413), the app explains why.
- Mobile attachment logs leave out file names and full file paths.

### Desktop, MCP, and Local API

- The built-in MCP server now runs inside the desktop app, with no separate helper program. On Mac it no longer needs macOS 13 or later. (#1337)
- Copy connection details marks the MCP server as HTTP, so clients such as Claude Code accept it. Copying also works on Linux AppImage builds. (#1337, #1359)
- The Local API and built-in MCP judge Focus by the local day. They enforce the Focus limit when an update stars a task or makes a queued star current, and they rank sequential Focus tasks the same way as the app. Self-hosted Cloud also enforces the Focus limit when a queued star becomes active.
- MCP due-date filters (`dueDateFrom`, `dueDateTo`) use the local calendar day.
- The Local API can edit an Area with `PATCH /areas/:id`. (#1370)
- The `mindwtr-mcp` package finds the database of a Snap install, asks the Local API only for the tasks a query needs, and marks the Cloud token as secret in its registry manifest.
- Desktop waits for AI consent before listing a provider's models.
- On macOS, clicking the Dock icon reopens the main window. (#1352)
- The desktop tray menu and Pomodoro phase controls are translated. (#1350, #1367)
- Dependency security updates clear the current dependency audit.

### Languages

- Traditional Chinese sample content in the sandbox is translated. Several Chinese terms are corrected, including account, read-only, token, session, the GTD settings, and contexts in Process Inbox. (#1335, #1340, #1364, #1365, #1369)
