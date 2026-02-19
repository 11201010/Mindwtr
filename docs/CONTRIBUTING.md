# Contributing to Mindwtr

Thanks for your interest in improving Mindwtr. This guide covers:

- Before you begin
- Code contribution process
- Development setup and workflow
- Testing and quality checks
- Pull request guidelines
- Documentation and translation contributions

Mindwtr is a Bun monorepo with:

- Desktop app (`apps/desktop`): Tauri + React + Vite
- Mobile app (`apps/mobile`): Expo + React Native
- Shared core package (`packages/core`): state models, storage adapters, and shared logic

## Before you begin

### 1) Follow our community standards

- Read and follow the [Code of Conduct](../CODE_OF_CONDUCT.md).
- Be respectful in issues, discussions, reviews, and commits.

### 2) Report security issues privately

- Do not open public issues for security vulnerabilities.
- Use [SECURITY.md](../SECURITY.md) for responsible disclosure instructions.

### 3) Start with an issue for non-trivial changes

For behavior changes, significant bug fixes, or new features, open (or confirm) an issue first.
This helps avoid duplicated work and keeps changes aligned with project goals.

When opening an issue, include:

- Platform and version (`desktop`, `mobile`, or both)
- Reproduction steps and expected behavior
- Actual behavior
- Screenshots, screen recordings, and logs when relevant

### 4) Keep product fit in mind

Mindwtr focuses on GTD and practical execution. Contributions are most likely to be accepted when they:

- Keep workflows simple by default
- Avoid unnecessary UI complexity
- Preserve data safety and reliability
- Work consistently across platforms when applicable

## Code contribution process

1. Find an issue to work on, or open one for discussion.
2. Fork the repository and create a branch in your fork.
3. Implement the change with focused scope.
4. Run relevant checks locally.
5. Open a pull request to `dongdongbh/Mindwtr:main`.
6. Link the issue in the PR (example: `Fixes #123`).

Branch naming examples:

- `fix/tray-preference-persistence`
- `feature/date-format-setting`
- `docs/contributing-update`

## Development setup and workflow

Run all commands from the repository root.

### Prerequisites

- Bun (workspace/package manager)
- Git
- Rust toolchain (required for Tauri desktop build/dev)
- System webview dependencies for Tauri on your OS
- Expo tooling for mobile development
- Android SDK and/or Xcode if building mobile natively

### Install dependencies

```bash
bun install
```

### Run the apps

Desktop (Tauri):

```bash
bun desktop:dev
```

Desktop UI only (browser/Vite):

```bash
bun desktop:web
```

Mobile (Expo):

```bash
bun mobile:start
```

Mobile on device/emulator:

```bash
bun mobile:android
bun mobile:ios
```

### Useful structure reference

- `apps/desktop/src`: desktop UI and desktop integrations
- `apps/mobile`: mobile UI and native bridge code
- `packages/core/src`: shared business logic, store, sync, and utilities
- `scripts/`: release and utility scripts
- `docs/`: markdown docs used by the project

## Testing and quality checks

Run checks relevant to your change.

Desktop lint:

```bash
bun run --filter mindwtr lint
```

Desktop tests (single pass, non-watch):

```bash
bun run --filter mindwtr test -- --run
```

Core tests:

```bash
bun run --filter @mindwtr/core test
```

Mobile tests:

```bash
bun run --filter mobile test
```

Optional e2e:

```bash
bun run test:e2e
```

## Coding conventions

- TypeScript first.
- Prefer functional React components and hooks.
- Keep imports grouped: external, workspace/internal, then relative.
- Match file-local formatting conventions:
  - desktop/core usually 4 spaces
  - mobile usually 2 spaces
- Keep code comments concise and only where logic is non-obvious.
- Favor accessibility-oriented test queries (`getByRole`, `getByLabelText`).

Naming:

- Components/providers: `PascalCase`
- Hooks: `useSomething`
- Utility modules: kebab-case (example: `storage-adapter.ts`)
- Tests: mirror source filename with `.test.ts`/`.test.tsx`

## Pull request guidelines

All submissions go through GitHub pull requests and maintainer review.

Please keep PRs small and focused:

- One bug fix, one feature, or one isolated refactor per PR
- Avoid bundling unrelated changes

Before opening a PR:

- Ensure relevant checks pass locally
- Rebase/merge your branch as needed to resolve conflicts
- Verify no unrelated files are included

In your PR description, include:

- What changed
- Why it changed
- Linked issue (`Fixes #...`)
- Test evidence (commands run and outcomes)
- Screenshots/recordings for UI changes
- Platform impact (`desktop`, `mobile`, `core`, or combinations)

Commit style:

- Use Conventional Commits when possible
- Examples:
  - `fix(desktop): persist tray preference on macOS`
  - `feat(core): add date format normalization`
  - `docs: clarify sync troubleshooting`

## Documentation contributions

Documentation updates are welcome in `docs/`, `README.md`, and `README_zh.md`.

When changing docs:

- Keep instructions accurate and runnable
- Prefer concrete examples over vague guidance
- Validate links
- Update both English and Chinese docs when the content is mirrored

Useful references:

- [Developer Guide](https://github.com/dongdongbh/Mindwtr/wiki/Developer-Guide)
- [Architecture](https://github.com/dongdongbh/Mindwtr/wiki/Architecture)
- [Wiki index](https://github.com/dongdongbh/Mindwtr/wiki)

## Translation contributions

Most translation strings live in:

- [`packages/core/src/i18n/locales/`](https://github.com/dongdongbh/Mindwtr/tree/main/packages/core/src/i18n/locales/)

When updating translations:

- Keep placeholders and interpolation keys unchanged
- Keep command tokens intact where parser behavior depends on English commands
- Confirm UI still fits in small mobile layouts

## Need help?

If you are unsure about scope or implementation details:

- Open a GitHub issue with a short proposal
- Join community chat on Discord: https://discord.gg/ahhFxuDBb4
- Ask for maintainer feedback before implementing large changes

Thanks again for contributing to Mindwtr.
