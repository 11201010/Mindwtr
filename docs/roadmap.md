# Mindwtr Roadmap

This document captures the phased product roadmap and how work splits between `@mindwtr/core` and the desktop/mobile apps.

---

## ✅ Phase 1 — GTD Completeness (Complete)

- ✅ Recurring Tasks Engine
- ✅ Tickler / Review Dates
- ✅ Project Lifecycle + Next Action Discipline

---

## ✅ Phase 2 — Daily Capture & Engagement (Complete)

- ✅ Shared Quick‑Add Parser (Natural Language)
- ✅ Frictionless Capture Entry Points (global hotkey, tray, share sheet)
- ✅ Notifications / Reminders with Snooze

---

## ✅ Phase 2.5 — Search & Quick Actions (Complete)

- ✅ Advanced Search + Saved Searches
- ✅ Subtask Progress Indicators
- ✅ Collapsible Sidebar (Desktop)

---

## ✅ Phase 3 — Trust, Sync, and Organization (Complete)

- ✅ Auto‑Sync + Status
- ✅ Bulk Actions & List Customization
- ✅ Task Dependencies / Blocking
- ✅ Hierarchical Contexts/Tags
- ✅ Areas (Project Groups)
- ✅ Accent Color / Theme Customization

---

## ✅ Phase 4 — Power‑User & Reference (Complete)

- ✅ Markdown Notes + Attachments
- ✅ Desktop Keyboard/A11y Pass
- ✅ Daily Digest Notifications
- ✅ Additional Sync Backends (WebDAV)

---

## 🔜 Phase 5 — Expansion

### 1) Android Widget
**Goal:** Surface agenda on home screen.

- **Mobile**
  - Expo home screen widget showing today's focus and due tasks.
  - Quick add from widget.

### 2) Web App
**Goal:** Browser-based access for any device.

- **Core**
  - Ensure store works in browser context.
- **Web**
  - Next.js or similar web app sharing `@mindwtr/core`.
  - PWA support for offline.

### 3) Cloud Sync
**Goal:** Optional cloud-based sync service.

- **Core/Backend**
  - Simple REST API for data sync.
  - End-to-end encryption option.

### 4) Integrations & Automation
**Goal:** Enable power users to automate capture and review.

- **Desktop/Core**
  - Optional local API server for add/list/complete/search.
  - CLI tool for scripting.
