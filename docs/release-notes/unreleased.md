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
