# Privacy Policy for Mindwtr

**Effective Date:** February 22, 2026

Mindwtr ("we", "our", or "us") is designed as a local-first application. We respect your privacy and aim to minimize data collection by design.

**1. Data Storage**
All data created within the app (tasks, projects, notes) is stored locally on your device.

**2. Data Sync**
If you choose to use sync features (for example File Sync, WebDAV, self-hosted sync, or Dropbox OAuth in supported builds), your data is transmitted directly between your device and your chosen storage/sync provider. We (the developer) do not have access to this data.

- **Dropbox OAuth sync (supported builds):** Mindwtr requests Dropbox App Folder access and syncs only app data files under `/Apps/Mindwtr/` (for example `data.json` and `attachments/*`).
- **Token handling:** OAuth access/refresh tokens are stored locally on your device and used only to call Dropbox APIs for your account.
- **FOSS builds:** Dropbox OAuth may be disabled in FOSS distributions.
- **Other providers via File Sync:** iCloud Drive, Google Drive, OneDrive, Syncthing, and similar tools can still be used indirectly through File Sync.

**3. Anonymous Usage Analytics (Heartbeat)**
In official non-FOSS builds, Mindwtr may send a small heartbeat event at most once per day to help us measure app health and adoption (for example DAU/MAU and distribution-channel usage).

- **What may be sent:** platform (for example iOS/Android/macOS/Windows/Linux), app version, distribution channel (for example App Store/Play Store/winget/Homebrew), coarse device class (for example phone/tablet/desktop), coarse OS major version (for example iOS 18 or Android 15), locale (for example en-US), and an app-generated random identifier.
- **Country data:** country may be derived server-side from edge network metadata during request handling.
- **What is not sent in the heartbeat payload:** task/project/note content, AI prompt content, email address, name, contacts, or files.
- **FOSS builds:** heartbeat analytics is disabled.

**4. Third-Party Services (AI)**
If you use optional AI features with your own API key (BYOK):

- **What data is sent:** the text you submit for AI processing (for example task title/notes/prompt content).
- **Who receives it:** your selected provider (for example OpenAI, Google Gemini, or Anthropic).
- **When it is sent:** only after you enable AI and accept the in-app consent prompt.
- **How it is sent:** directly from your device to that provider.
- **Mindwtr developer access:** we do not proxy these requests and do not collect or store this AI request content.

**5. Contact Us**
If you have any questions about this Privacy Policy, please contact us via our GitHub repository: https://github.com/dongdongbh/Mindwtr
