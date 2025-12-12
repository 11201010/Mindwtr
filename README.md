<div align="center">

<img src="apps/mobile/assets/images/icon.png" width="120" alt="Mindwtr Logo">

# Mindwtr

A complete Getting Things Done (GTD) productivity system for desktop and mobile. *Mind Like Water.*

*New to GTD? Read [GTD in 15 minutes](https://hamberg.no/gtd) for a quick introduction.*

[![CI](https://github.com/dongdongbh/Mindwtr/actions/workflows/ci.yml/badge.svg)](https://github.com/dongdongbh/Mindwtr/actions/workflows/ci.yml)
[![GitHub stars](https://img.shields.io/github/stars/dongdongbh/Focus-GTD?style=social)](https://github.com/dongdongbh/Mindwtr/stargazers)
[![GitHub license](https://img.shields.io/github/license/dongdongbh/Focus-GTD)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/dongdongbh/Focus-GTD)](https://github.com/dongdongbh/Mindwtr/commits/main)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dongdongbh/Mindwtr/pulls)
[![Sponsor](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23fe8e86)](https://github.com/sponsors/dongdongbh)


</div>

## Features

### GTD Workflow
- **Capture** - Quick add tasks from anywhere (global hotkey, tray, share sheet)
- **Clarify** - Guided inbox processing with 2-minute rule
- **Organize** - Projects, contexts, and status lists
- **Reflect** - Weekly review wizard
- **Engage** - Context-filtered next actions

### Views
- 📥 **Inbox** - Capture zone with processing wizard
- ▶️ **Next Actions** - Context-filtered actionable tasks
- 📁 **Projects** - Multi-step outcomes with areas
- 🏷️ **Contexts** - Hierarchical contexts (@work/meetings)
- ⏳ **Waiting For** - Delegated items
- 💭 **Someday/Maybe** - Deferred ideas
- 📅 **Calendar** - Time-based planning
- 📋 **Board** - Kanban-style drag-and-drop
- 📝 **Review** - Guided GTD weekly review

### Productivity Features
- 🔍 **Global Search** - Search operators (status:, context:, due:<=7d)
- 💾 **Saved Searches** - Save and reuse search filters
- 📦 **Bulk Actions** - Multi-select, batch move/tag/delete
- 🔗 **Task Dependencies** - Block tasks until prerequisites complete
- 📎 **Attachments** - Files and links on tasks
- ✏️ **Markdown Notes** - Rich text descriptions with preview
- 🔔 **Notifications** - Due date reminders with snooze
- 📊 **Daily Digest** - Morning briefing + evening review

### Data & Sync
- 📁 **File Sync** - Dropbox, Google Drive, Syncthing, etc.
- 🌐 **WebDAV Sync** - Nextcloud, ownCloud, self-hosted
- 🔀 **Smart Merge** - Last-write-wins prevents data loss
- 📤 **Export/Backup** - Export data to JSON

### Cross-Platform
- 🖥️ **Desktop** - Tauri v2 (macOS, Linux, Windows)
- 📱 **Mobile** - React Native/Expo (iOS, Android)
- ⌨️ **Keyboard Shortcuts** - Vim and Emacs presets
- 🎨 **Themes** - Light/Dark with accent color
- 🌍 **i18n** - English and Chinese

## Installation

### Desktop (Linux)

**Arch Linux (AUR):**
```bash
# Using yay
yay -S mindwtr-bin

# Using paru
paru -S mindwtr-bin
```
📦 [AUR Package](https://aur.archlinux.org/packages/mindwtr-bin)

**Debian/Ubuntu:**
Download the `.deb` from [GitHub Releases](https://github.com/dongdongbh/Mindwtr/releases) and install:
```bash
sudo dpkg -i mindwtr_*.deb
```

**AppImage (Universal):**
Download the `.AppImage` from [GitHub Releases](https://github.com/dongdongbh/Mindwtr/releases):
```bash
chmod +x Mindwtr_*.AppImage
./Mindwtr_*.AppImage
```

### Desktop (Windows)
Download the installer (`.msi` or `.exe`) from [GitHub Releases](https://github.com/dongdongbh/Mindwtr/releases) and run it.

### Desktop (macOS)
Download the disk image (`.dmg`) from [GitHub Releases](https://github.com/dongdongbh/Mindwtr/releases), open it, and drag the application to your Applications folder.

> **Note:** If macOS says the app is "damaged" or from an "unidentified developer", run:
> ```bash
> xattr -cr /Applications/Mindwtr.app
> ```
> Then open the app normally. This is required because the app is not notarized with Apple.

### Mobile

**Android:**
Download the APK from [GitHub Releases](https://github.com/dongdongbh/Mindwtr/releases).

**iOS:**
iOS builds require an Apple Developer account ($99/year). Currently available as simulator builds only.

## Data Storage

Tasks and projects are stored locally on your device:
- **Desktop**: `~/.config/mindwtr/data.json`
- **Mobile**: Device storage (AsyncStorage)

Sync via File (Dropbox, etc.) or WebDAV (Nextcloud, etc.) can be configured in Settings.

## Documentation

- 📚 [Wiki](https://github.com/dongdongbh/Mindwtr/wiki) - Complete user guide
- 🚀 [Getting Started](https://github.com/dongdongbh/Mindwtr/wiki/Getting-Started)
- 💡 [GTD Best Practices](https://github.com/dongdongbh/Mindwtr/wiki/GTD-Best-Practices)

## Development

For developers, see the [Development Guide](docs/development.md).

## Roadmap

- [ ] 📱 **Android Widget** - Agenda widget for home screen
- [ ] ☁️ **Cloud Sync** - Optional cloud-based sync service
- [ ] 🌐 **Web App** - Browser-based version
- [ ] 🔌 **API/CLI** - Automation and scripting support

## License

MIT
