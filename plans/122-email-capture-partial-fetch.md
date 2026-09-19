# Plan 122: Fetch only the first 256 KiB of each captured email instead of the whole message

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. The coordinator maintains `plans/README.md`; do not edit it.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src-tauri/src/email_capture.rs` — if the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 120 touches only the TypeScript half of the same feature)
- **Category**: bug
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

Desktop email capture keeps at most 16 000 characters of text from each email. To get them it asks the mail server for `BODY.PEEK[]`, which is the whole raw message with every attachment, for up to 25 messages in one command. The IMAP library holds the whole reply in memory. One forwarded email with a 25 MB PDF means 25 MB downloaded and held to keep a few lines; a first run on a full folder can mean hundreds of megabytes. A slow link can then hit the 60-second read timeout, which is treated as a network error and retried every five minutes. IMAP has a partial fetch: `BODY.PEEK[]<0.N>` returns only the first N bytes. The headers and the text part sit at the start of a normal email, so the first 256 KiB is enough.

## Current state

All paths are relative to the repo root.

- `apps/desktop/src-tauri/src/email_capture.rs` — IMAP polling. `poll_mailbox` (`:603-655`) fetches; `build_email_capture_message` (`:306`) parses raw bytes with the `mail-parser` crate, which parses whatever bytes it is given.

`apps/desktop/src-tauri/src/email_capture.rs:9-15` (today):

```rust
// Bounded work per poll; the mailbox is the queue, so leftovers are picked up
// by follow-up polls (`has_more`) instead of one unbounded fetch.
const EMAIL_CAPTURE_BATCH_LIMIT: usize = 25;
const EMAIL_CAPTURE_BODY_CHAR_LIMIT: usize = 16_000;
const EMAIL_CAPTURE_SEEN_MESSAGE_ID_LIMIT: usize = 500;
const EMAIL_CAPTURE_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const EMAIL_CAPTURE_IO_TIMEOUT: Duration = Duration::from_secs(60);
```

`apps/desktop/src-tauri/src/email_capture.rs:633-640` (today):

```rust
        let fetches = session
            .uid_fetch(set, "(UID BODY.PEEK[])")
            .map_err(|error| classify_imap_error(error, "other"))?;
        for fetch in fetches.iter() {
            let Some(uid) = fetch.uid else { continue };
            max_fetched_uid = max_fetched_uid.max(uid);
            let Some(raw) = fetch.body() else { continue };
            let message = build_email_capture_message(uid, uid_validity, raw);
```

Already checked for you: in the `imap` 2.4.1 crate, `Fetch::body()` matches `AttributeValue::BodySection { section: None, data: Some(body), .. }`. The `..` ignores the partial-fetch offset, so `body()` also returns the data of a `BODY[]<0>` reply. No other call needs to change.

Test style to copy, `apps/desktop/src-tauri/src/email_capture.rs:885-904`:

```rust
    #[test]
    fn build_message_extracts_subject_from_and_text_body() {
        let raw = concat!(
            "Message-ID: <abc-123@example.com>\r\n",
            "From: Jane Doe <jane@example.com>\r\n",
            "To: capture@example.com\r\n",
            "Subject: =?utf-8?q?Renew_passport?=\r\n",
            "Date: Tue, 14 Jul 2026 08:30:00 +0000\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "\r\n",
            "Bring the old passport and two photos.\r\n",
        );
        let message = build_email_capture_message(12, 7, raw.as_bytes());
        assert_eq!(message.uid, 12);
        assert_eq!(message.message_id, "abc-123@example.com");
        …
```

## Commands you will need

Run from the repo root. Keep build output on disk under `/home/dd` (never `/tmp`): the command below already sets the shared target directory.

| Purpose | Command | Expected |
|---|---|---|
| Rust tests | `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib email_capture` | all pass (one network test stays ignored) |
| Whitespace | `rtk git diff --check` | no output |

## Scope

**In scope** (the only file you may modify):
- `apps/desktop/src-tauri/src/email_capture.rs`

**Out of scope** (do NOT touch):
- `apps/desktop/src-tauri/Cargo.toml` — no crate change or upgrade.
- `apps/desktop/src/lib/email-capture.ts` (plan 120 owns it).
- The state file, the watermark rules, `select_new_uids`, `merge_email_capture_state`.
- `plans/README.md`.

## Git workflow

- One commit for this plan, message: `fix(desktop): fetch only the head of each captured email`. Repo style, no tooling mentions, do not push.

## Steps

### Step 1: failing tests

In the `tests` module of `email_capture.rs` add two tests:

1. `fetch_query_asks_for_a_bounded_part_of_each_message`: assert `EMAIL_CAPTURE_FETCH_QUERY == "(UID BODY.PEEK[]<0.262144>)"` and `EMAIL_CAPTURE_FETCH_BYTE_LIMIT == 262_144`. (These constants do not exist yet, so the test module will not compile — that is the expected red state.)
2. `build_message_reads_a_message_cut_inside_an_attachment`: build a multipart email as a `String` — headers (`Message-ID`, `From`, `Subject: Report`, `Content-Type: multipart/mixed; boundary="b1"`), a `text/plain` part with the body `See the attached report.`, then an `application/pdf` part with `Content-Transfer-Encoding: base64` whose body is `"QUJD".repeat(100_000)` (400 000 characters), then the closing boundary. Cut the bytes with `&raw.as_bytes()[..EMAIL_CAPTURE_FETCH_BYTE_LIMIT]` and pass the slice to `build_email_capture_message(5, 7, …)`. Assert `subject == "Report"`, `from` is the sender, `message_id` is the header value, and `body_text == "See the attached report."`.

**Verify**: run the Rust test command → compilation FAILS on the two missing constants.

### Step 2: implement

1. Add below `EMAIL_CAPTURE_BODY_CHAR_LIMIT` (`:12`):

```rust
// Only the head of each message is fetched: headers and the text part come first in
// normal mail, and nothing past EMAIL_CAPTURE_BODY_CHAR_LIMIT characters is kept anyway.
// A full `BODY.PEEK[]` would download every attachment into memory.
const EMAIL_CAPTURE_FETCH_BYTE_LIMIT: usize = 262_144;
const EMAIL_CAPTURE_FETCH_QUERY: &str = "(UID BODY.PEEK[]<0.262144>)";
```

2. At `:634` replace the literal with the constant: `.uid_fetch(set, EMAIL_CAPTURE_FETCH_QUERY)`.

**Verify**: run the Rust test command → all pass, including the two new tests. `rtk proxy grep -n "BODY.PEEK\[\]" apps/desktop/src-tauri/src/email_capture.rs` → the only matches are the constant, its comment and the test.

## Test plan

- The two tests in Step 1. The second one is the regression test: it proves a message cut in the middle of an attachment still yields subject, sender, id and text.
- `poll_mailbox` itself needs a live TLS session and has no unit test; the constant test pins the query string instead.

## Done criteria

- [ ] The Rust test command passes with the two new tests
- [ ] `rtk proxy grep -c "(UID BODY.PEEK\[\])" apps/desktop/src-tauri/src/email_capture.rs` → `0`
- [ ] `rtk git status --short` shows only `apps/desktop/src-tauri/src/email_capture.rs`
- [ ] `rtk git diff --check` clean

## STOP conditions

- A "Current state" excerpt does not match the live code.
- The cut-message test fails because `mail-parser` returns an empty `body_text` for a truncated multipart message. Report the actual values; do not raise the limit or change the parser on your own.
- The build needs a change to `Cargo.toml` or `Cargo.lock`.

## Maintenance notes

- An email whose text part comes AFTER a large attachment (rare; some scanners do this) will now import with an empty description. The subject still becomes the title.
- If the limit is ever changed, change the number in both constants; the first test keeps them in step.
- Not verifiable in unit tests: that a given mail server honours partial fetch. Gmail, Fastmail, Outlook and Dovecot do (it is part of base IMAP4rev1). A manual check with a real mailbox is a reasonable pre-release step.
