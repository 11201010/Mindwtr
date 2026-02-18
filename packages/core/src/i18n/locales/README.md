# Locale Contribution Guide

Mindwtr keeps translations under this folder so community contributions are easy to submit.

- `en.ts`: English source strings (base dictionary).
- `zh.ts`: Full Chinese dictionary.
- `*.ts` for other languages: manual override dictionaries.

For languages using overrides, only add keys that need custom wording.
Any missing key is automatically translated from English by the i18n build step.

## How to contribute a language fix

1. Open the language file (for example `fr.ts`).
2. Add or update keys in `<lang>Overrides`.
3. Keep command tokens in English where applicable (`/due:`, `/note:`, `/next`, `@context`, `#tag`, `+Project`).
4. Run tests:

```bash
bun run --filter @mindwtr/core test
```
