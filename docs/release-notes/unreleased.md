# Mindwtr Unreleased

Changes collected since the latest stable release.

## Full Change List

- Mindwtr is now fully available in Danish, bringing the app to 23 language options across desktop and mobile.
- Task area pickers on desktop and mobile follow the custom area order from Settings, including filtered search results (#1217).
- Mobile task Preview keeps the checklist input above the keyboard while typing and adding items (#1218).
- Android: tapping the blank background of a home-screen widget, the space below the last row, a section heading, or the "nothing here" message now opens Focus, whichever list the widget shows. The widget title still opens the list it displays, and the chevron still opens the list chooser. (#1173)
- Mobile: the Calendar settings link to the calendar setup guide now appears in your app language instead of always in English. (#1222)
- Desktop: the Someday **Move to section** dialog matches the other dialogs in spacing, button size and focus rings, names the section picker, and no longer steals keyboard focus back to the task row while it is open.
- Calendar: an event Mindwtr itself pushed to your device calendar is no longer imported back as an external event. Pushed events now carry a hidden Mindwtr marker, so the mirror is recognised even in a calendar you did not name.
- Desktop and mobile: the Contexts view can filter on several contexts and tags at once, with an **All** and **Any** toggle. **All** keeps tasks that carry every selected token, **Any** keeps tasks that carry at least one. Selecting a single token works as before, and the chip's remove button now reads in your app language. (#1224)
- Desktop: typing a time by hand now follows the time format from Settings. The 12-hour and 24-hour choice applies to the start-time and due-time fields, the calendar dialogs, the quick action menu and the notification time pickers.
- Desktop and mobile: **Settings -> Manage** now counts every task that belongs to a person, whether it is assigned to them or carries their `@name` context, and the count is a button. Press it to open Global Search on that person, completed tasks included. Global Search also understands a `person:"Name"` term, and quoted values may now contain escaped quotes.
- Mobile: **Settings -> Task editor layout** adds **Open tasks in**, which decides what a normal task tap opens on this device. **Automatic** keeps today's behaviour, **Preview** always opens the preview tab, and **Edit** always opens the edit tab. The choice stays on the device and is not synced. (#1227)
- Desktop and mobile: the morning and evening digests now run on their own switches. Turning task reminders off no longer silently cancels a digest you had enabled, the same way the weekly review reminder already worked.
- Desktop: the Local API can create and update projects with `POST /projects` and `PATCH /projects/:id`, and triage a task with `status` on `PATCH /tasks/:id`. Terminal statuses still need `/complete` or `/archive`, and a request blocked by the record's state answers `409` with a message that says what to do. (#1228, #1229)
- Windows: the README shows how to install Mindwtr with Scoop. (#1223)
