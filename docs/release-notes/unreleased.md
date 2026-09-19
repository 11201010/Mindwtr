# Mindwtr Unreleased

Changes collected since the latest stable release.

## Full Change List

- Mindwtr is now fully available in Danish, bringing the app to 23 language options across desktop and mobile.
- Desktop and mobile: task screens show fewer choices at once. Desktop gains direct **Sort** and **Group** controls, simpler filters and a tidier project layout. Done and Archived are now two tabs of one **History** destination, and the mobile Menu is a compact grid. The old Done and Archived links still open the matching tab, and nothing changed about how tasks are stored, synced, completed, archived or restored.
- Desktop: **Settings -> General -> Look & feel** gains a **Font** box. Click it to browse the fonts installed on this computer, type to narrow the list, and pick one to apply. Leave it empty to keep the app default. The choice syncs, and a font that is missing on another computer falls back to the default. (#1244)
- Windows and macOS: an installed Mindwtr now keeps its settings in a `config` folder and its data in a `data` folder inside the same profile folder, the way the portable build already did. The first start of this version moves those files once and leaves everything else in the folder alone. Going back to an older version after that is not supported, because an older version only looks in the old place. If you read your database with the MCP server, update it to `mindwtr-mcp` 1.1.10 or later. Linux is not affected. (#1245)
- Mobile: Apple Reminders can now import on its own. Once you have chosen a Reminders list, the new **Import automatically** switch runs the same import each time Mindwtr opens or comes back to the foreground. It never asks for Reminders access by itself, and a manual and an automatic import cannot add the same reminder twice. (#1238)
- Inbox: choosing **Start later** now offers a Project and an Area, the same way **Incubate** already did. (#1239)
- Desktop: **Save & edit** now follows the task to the list it was filed under, so the editor stays open on the task you just saved. (#1243)
- Desktop: the edit keyboard shortcut now works inside the calendar pop-up, so you can open a task for editing without leaving the calendar. (#1241)
- Mobile: the calendar schedule view lists the scheduled days before the planning list. (#1240)
- Mobile: a task filed under an area with no project now names that area on the task row, the same as on desktop. (#1246)
- Mobile: compact dates on the home-screen widgets follow the date format from Settings instead of the app language. (#1242)
- Mobile: task Preview keeps the checklist input clear of the keyboard suggestion bar while you type and add items. (#1218)
- Linux: reminder notifications now carry the Mindwtr logo. (#1232)
- About: the Terms of Use sits next to Privacy, and every About row shows the address it opens.
- The occasional notice asking you to support Mindwtr now appears at most once every six months across all the devices that share your data, instead of once per device. Anonymous diagnostics, which you can opt out of in Settings, now carry one id per set of data, so one person on several devices is counted once. (#1237)
- Trash: **Clear Trash** now removes only the items the screen is showing. With an area filter or a search active it used to remove every trashed item, including the ones you could not see. With no filter it works as before. Trash also says how long items are kept before they are removed for good.
- Projects: **Undo** right after deleting a project now puts its tasks back into the project, instead of bringing back an empty project.
- Desktop: you can drag a task onto **History** in the sidebar to mark it done, and a folded sidebar group opens while you drag a task over it.
- Desktop: **Save & edit** follows a task with a future start date to the list that actually shows it.
- Desktop: arrow keys work inside the **Dates…** submenu of a task's menu, an open Filters panel no longer closes when you press Escape in a dialog, and the Font list keeps the highlighted font in view.
- Desktop filters: a filter chip that the current list does not apply is shown muted, and the list no longer claims to be filtered by it. This also fixes the Archived list.
- AI: a custom AI endpoint URL is now kept per device, like the API key. If you use one, enter it once on each device. Before this, the address could arrive through sync and receive this device's API key.
- Import and voice: due dates imported from Todoist or spoken to the assistant without a time stay date-only. They no longer gain a clock time or a reminder.
- Self-hosted sync: a file the server will never accept (a program file, or a file over the server's size limit) no longer blocks all sync from that device. After three refusals the attachment is set aside and sync continues; the file stays on your disk.
- Email capture: a captured email is turned into a task only once, even after a crash or on a second computer, and Mindwtr now downloads only the first part of each message instead of the whole message with its attachments.
- Capture webhook: a sender can add a `captureId`. Sending the same value again on a retry adds nothing.
- A permanently deleted task or project can no longer be restored from an old link. Before this, **Restore** on such a link created an empty item named "(deleted)".
- Mobile: Apple Reminders import records a reminder as imported only after its task is safely saved, so closing the app mid-import cannot lose or duplicate a reminder.
- Mobile: widget dates follow the device's day and month order also after a background sync, the History screen is reopened after Android closes the app, and the Inbox filter button shows how many filters are active again.
- Time estimates: both apps now offer the same list of durations, including 15 minutes. The old setting that shortened the list has no screen any more and is no longer applied.
- Windows and macOS upgrade fixes for the new `config` and `data` folders (#1245): attachments, voice notes and a downloaded speech model saved before the move are found again, a voice note is kept when its transcription fails, and two launches at the same moment can no longer leave one of them on the old folder.
- Command-line tools, script API and MCP server: they find the database in the new `data` folder, also when a path was pinned in a configuration before the move, and on Flatpak and sandboxed macOS installs. A leading `~` in an MCP `--db` path now works. Tasks saved by the command-line tools keep every field, and an older copy of a task can no longer overwrite a newer one. MCP users need `mindwtr-mcp` 1.1.10 or later.
- Windows note: while an MCP server is running and holds the database open, the one-time move into `config` and `data` cannot finish. It is rolled back safely and tried again on the next start with no MCP client running.
- Logs: API keys in the newer formats used by OpenAI, Anthropic, xAI, Groq and OpenRouter are now removed from diagnostic logs, and ordinary words are no longer cut by mistake.
- Desktop database: nine duplicate search indexes are removed on the first start, which makes saving faster.
