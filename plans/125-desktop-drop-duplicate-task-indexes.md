# Plan 125: Drop the nine duplicate task indexes from the desktop SQLite database

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving on. If a STOP condition occurs, stop and report; do not improvise. Do NOT edit `plans/README.md`; the coordinator maintains the index.
>
> **Drift check (run first)**: `rtk git diff --stat 561cfdfa0..HEAD -- apps/desktop/src-tauri/src/storage.rs` — if the file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `561cfdfa0`, 2026-09-19

## Why this matters

An index is a sorted side table that lets SQLite find rows fast. Every insert or update of a task must also update every index on the `tasks` table. The desktop schema creates nine task indexes twice: once under a snake_case name and once under a camelCase name, on exactly the same columns. SQLite keeps one tree per name, so every desktop database pays nine extra index updates on every task write, and the file is larger than it needs to be. Nothing reads the snake_case names. After this plan every old database drops the nine extra indexes on its next open, and new databases never create them. The same columns stay indexed by the camelCase twins, so no query gets slower.

## Current state

One file: `apps/desktop/src-tauri/src/storage.rs` — the desktop (Rust/Tauri) SQLite layer. It holds the schema text, the open-time migration, and its tests.

**The first CREATE block (to be removed)** — `storage.rs:116-125`, inside the `SQLITE_SCHEMA` string that starts at `:64`:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updatedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deletedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(dueDate);
CREATE INDEX IF NOT EXISTS idx_tasks_start_time ON tasks(startTime);
CREATE INDEX IF NOT EXISTS idx_tasks_review_at ON tasks(reviewAt);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(createdAt);
CREATE INDEX IF NOT EXISTS idx_tasks_status_deleted_at ON tasks(status, deletedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_deleted_at ON tasks(projectId, status, deletedAt);
```

**The second CREATE block (stays)** — `storage.rs:282-293`, the last lines of the same `SQLITE_SCHEMA` string:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_deletedAt ON tasks(deletedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_dueDate ON tasks(dueDate);
CREATE INDEX IF NOT EXISTS idx_tasks_startTime ON tasks(startTime);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewAt ON tasks(reviewAt);
CREATE INDEX IF NOT EXISTS idx_tasks_createdAt ON tasks(createdAt);
CREATE INDEX IF NOT EXISTS idx_tasks_updatedAt ON tasks(updatedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_status_deletedAt ON tasks(status, deletedAt);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status_deletedAt ON tasks(projectId, status, deletedAt);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_areaId ON projects(areaId);
"#;
```

**The exact nine names to drop.** Each pair was checked column by column at commit `561cfdfa0`: same table, same columns in the same order, neither is `UNIQUE`, neither has a `WHERE` clause.

| # | DROP this name (`storage.rs` line) | Twin that stays (line) | Columns |
|---|---|---|---|
| 1 | `idx_tasks_project_id` (117) | `idx_tasks_projectId` (283) | `projectId` |
| 2 | `idx_tasks_updated_at` (118) | `idx_tasks_updatedAt` (289) | `updatedAt` |
| 3 | `idx_tasks_deleted_at` (119) | `idx_tasks_deletedAt` (284) | `deletedAt` |
| 4 | `idx_tasks_due_date` (120) | `idx_tasks_dueDate` (285) | `dueDate` |
| 5 | `idx_tasks_start_time` (121) | `idx_tasks_startTime` (286) | `startTime` |
| 6 | `idx_tasks_review_at` (122) | `idx_tasks_reviewAt` (287) | `reviewAt` |
| 7 | `idx_tasks_created_at` (123) | `idx_tasks_createdAt` (288) | `createdAt` |
| 8 | `idx_tasks_status_deleted_at` (124) | `idx_tasks_status_deletedAt` (290) | `status, deletedAt` |
| 9 | `idx_tasks_project_status_deleted_at` (125) | `idx_tasks_project_status_deletedAt` (291) | `projectId, status, deletedAt` |

`idx_tasks_status` (116 and 282) has the SAME name in both blocks, so it was never duplicated. It is NOT dropped. Line 116 is removed only because line 282 creates the same index.

**Nothing else refers to the nine names.** A search of `apps/`, `packages/`, `scripts/` and `docs/` for the nine snake_case names finds only `storage.rs:117-125`. There is no `DROP INDEX` anywhere in `apps/desktop/src-tauri/src/` or `packages/core/src/` today.

**The schema version and the fast path** — `storage.rs:40-43`:

```rust
// Version 8 adds tasks.cancelledAt and projects.cancelledAt. Increment this whenever SQLITE_SCHEMA or
// an ensure_* migration changes; otherwise the warm schema-state fast path can
// incorrectly skip the migration on an existing database.
const STORAGE_SCHEMA_VERSION: i64 = 8;
```

`initialize_sqlite_schema` (`storage.rs:491-581`) returns early when the stored version equals `STORAGE_SCHEMA_VERSION` and SQLite's own schema counter is unchanged (`:498-501`). Otherwise it runs the schema text and then a list of `ensure_*` steps, all inside one `BEGIN IMMEDIATE` transaction — `storage.rs:504-508`:

```rust
        transaction
            .execute_batch(SQLITE_SCHEMA)
            .map_err(|e| e.to_string())?;
        ensure_orphan_section_tombstones_schema(&transaction)?;
        ensure_column(&transaction, "tasks", "energyLevel", "TEXT")?;
```

So a bump from 8 to 9 is what makes an existing database run the new step once.

**Convention to match for a migration step** — `storage.rs:1311-1329` (`ensure_tasks_organization_indexes`): a private `fn name(conn: &Connection) -> Result<(), String>` that calls `conn.execute(<literal SQL>, [])` and maps the error with `.map_err(|e| e.to_string())?`. Match that shape.

**Convention to match for the test** — `storage.rs:6511-6540` (`sqlite_open_migrates_version_six_projects_table_missing_start_date`), in the `mod tests` block that starts at `:5551`:

```rust
        let temp = tempfile::tempdir().expect("tempdir");
        let db_path = temp.path().join("version-six-projects.sqlite");
        let conn = Connection::open(&db_path).expect("open legacy database");
        ...
        conn.execute_batch(&version_six_schema)
            .expect("create version six schema");
        let schema_generation = sqlite_schema_generation(&conn).expect("read legacy generation");
        conn.execute(
            "INSERT INTO storage_schema_state (id, storage_version, schema_generation) VALUES (1, 6, ?1)",
            params![schema_generation],
        )
        .expect("record version six schema state");
        drop(conn);

        let reopened = open_sqlite_path(&db_path).expect("migrate version six database");
        ...
        assert_eq!(state.storage_version, STORAGE_SCHEMA_VERSION);
```

**Other programs open the same file.** The MCP server and the repo's CLI open the desktop database and run core's `ensureSchema()` (`packages/core/src/sqlite-schema.ts:229-247`). Core creates only camelCase names (the same nine twin names as above, plus extra ones such as `idx_tasks_project_deletedAt ON tasks(projectId, deletedAt)` and `idx_tasks_completedAt ON tasks(completedAt)`). Core never creates a snake_case name, so a dropped index cannot come back. `storage_schema_state` is a Rust-only table; core does not read it. When core adds an index, SQLite's schema counter changes, the Rust fast path misses, and the whole step list runs again. That is why the new step must be safe to run any number of times.

## Commands you will need

Run all commands from the repository root.

| Purpose | Command | Expected |
|---|---|---|
| New tests | `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib duplicate_task_indexes` | see each step |
| Whole storage module | `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib storage::` | all pass |
| Whitespace | `rtk git diff --check` | no output |

The first cargo run compiles the crate and can take several minutes. Keep `CARGO_TARGET_DIR` exactly as written (build output must stay on disk under `/home/dd`, never in `/tmp`).

## Scope

**In scope** (the only file you may modify):
- `apps/desktop/src-tauri/src/storage.rs`

**Out of scope** (do NOT touch):
- `packages/core/src/sqlite-schema.ts`, `packages/core/src/sqlite-adapter.ts` and their tests — core's schema must not change in this plan.
- Any other index. In particular do NOT drop `idx_tasks_status`, `idx_people_updated_at`, `idx_people_deleted_at` (`storage.rs:197-198`; they have no camelCase twin in this file), or any index that looks "unused". Retiring unused indexes is a separate, recorded follow-up.
- `apps/desktop/src-tauri/src/storage_layout.rs` (another worker is editing it).
- `plans/README.md`.

## Git workflow

- One commit for this plan. Message: `perf(desktop): drop the nine task indexes that duplicate camelCase ones`. Repo style is conventional commits (example from `git log`: `fix(desktop): let a waiter follow a holder that finished (#1245)`). No tooling mentions in the message. Do not push.

## Steps

### Step 1: write the failing tests

In `apps/desktop/src-tauri/src/storage.rs`, inside `mod tests`, directly after the test `sqlite_open_migrates_version_seven_tables_missing_cancellation_timestamps` (it starts at `:6543`), add one helper and two tests.

Helper (test-only). It returns every index on `tasks` that was created by a `CREATE INDEX` statement, with its columns in order. `sql IS NOT NULL` leaves out the automatic primary-key index.

```rust
    fn task_index_columns(conn: &Connection) -> Vec<(String, Vec<String>)> {
        let mut names_stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL ORDER BY name")
            .expect("prepare index list");
        let names: Vec<String> = names_stmt
            .query_map([], |row| row.get(0))
            .expect("list task indexes")
            .collect::<Result<_, _>>()
            .expect("read task index names");
        names
            .into_iter()
            .map(|name| {
                let mut columns_stmt = conn
                    .prepare("SELECT name FROM pragma_index_info(?1) ORDER BY seqno")
                    .expect("prepare index info");
                let columns: Vec<String> = columns_stmt
                    .query_map(params![name], |row| row.get(0))
                    .expect("read index columns")
                    .collect::<Result<_, _>>()
                    .expect("collect index columns");
                (name, columns)
            })
            .collect()
    }
```

Both tests share this table of the nine pairs (put it next to the helper, test-only):

```rust
    const DUPLICATE_TASK_INDEX_PAIRS: &[(&str, &str, &[&str])] = &[
        ("idx_tasks_project_id", "idx_tasks_projectId", &["projectId"]),
        ("idx_tasks_updated_at", "idx_tasks_updatedAt", &["updatedAt"]),
        ("idx_tasks_deleted_at", "idx_tasks_deletedAt", &["deletedAt"]),
        ("idx_tasks_due_date", "idx_tasks_dueDate", &["dueDate"]),
        ("idx_tasks_start_time", "idx_tasks_startTime", &["startTime"]),
        ("idx_tasks_review_at", "idx_tasks_reviewAt", &["reviewAt"]),
        ("idx_tasks_created_at", "idx_tasks_createdAt", &["createdAt"]),
        ("idx_tasks_status_deleted_at", "idx_tasks_status_deletedAt", &["status", "deletedAt"]),
        (
            "idx_tasks_project_status_deleted_at",
            "idx_tasks_project_status_deletedAt",
            &["projectId", "status", "deletedAt"],
        ),
    ];
```

Test A — `sqlite_open_drops_duplicate_task_indexes_from_a_version_eight_database`. Build the old shape by hand so the fixture keeps working after Step 2 removes the first block:

1. `tempfile::tempdir()`, `Connection::open(&db_path)`, `conn.execute_batch(SQLITE_SCHEMA)`.
2. For each pair, run `CREATE INDEX IF NOT EXISTS <snake name> ON tasks(<columns joined with ", ">)` (build the SQL with `format!`; the names are constants from the table above).
3. Simulate MCP/CLI having applied core's schema to the same file: run `CREATE INDEX IF NOT EXISTS idx_tasks_project_deletedAt ON tasks(projectId, deletedAt)` and `CREATE INDEX IF NOT EXISTS idx_tasks_completedAt ON tasks(completedAt)`.
4. Seed one row: `INSERT INTO tasks (id, title, status, createdAt, updatedAt) VALUES ('kept-task', 'Keep task', 'next', '2026-09-01', '2026-09-01')`.
5. Record the OLD version with the literal `8` (not the constant): `INSERT INTO storage_schema_state (id, storage_version, schema_generation) VALUES (1, 8, ?1)` with `sqlite_schema_generation(&conn)`. Then `drop(conn)`.
6. `let reopened = open_sqlite_path(&db_path).expect("migrate version eight database");`
7. Assert, using `task_index_columns(&reopened)`:
   - for every pair: no index is named the snake name;
   - for every pair: exactly ONE index has exactly that column list (`.filter(|(_, columns)| columns == expected).count() == 1`), and its name is the camelCase twin;
   - `idx_tasks_status`, `idx_tasks_project_deletedAt` and `idx_tasks_completedAt` still exist;
   - `SELECT title FROM tasks WHERE id = 'kept-task'` returns `Keep task`;
   - `stored_sqlite_schema_state(&reopened)` has `storage_version == STORAGE_SCHEMA_VERSION`.
8. Idempotence: `drop(reopened)`, call `open_sqlite_path(&db_path)` again and expect `Ok`; then call the new step directly twice on that connection (`drop_duplicate_task_indexes(&conn)`, the function Step 2 adds) and expect `Ok(())` both times; then repeat the "exactly one index per column list" assertion.

Test B — `sqlite_open_creates_no_duplicate_task_indexes_in_a_new_database`: `open_sqlite_path` on a fresh temp path, then the same first two assertions from item 7.

Because Test A calls `drop_duplicate_task_indexes`, which does not exist yet, add this stub ABOVE `fn ensure_tasks_organization_indexes` (`:1311`) so the crate compiles and the tests fail for the right reason:

```rust
fn drop_duplicate_task_indexes(_conn: &Connection) -> Result<(), String> {
    Ok(())
}
```

**Verify**: `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib duplicate_task_indexes` → 2 tests run, BOTH FAIL on the "no index is named the snake name" assertion. If either passes now, STOP (the fixture is not exercising the old shape).

### Step 2: add the migration step, remove the first block, bump the version

All in `apps/desktop/src-tauri/src/storage.rs`:

1. Replace the stub with the real step, keeping it directly above `fn ensure_tasks_organization_indexes`:

```rust
// Until schema version 9 the schema text created these nine task indexes twice:
// once under a snake_case name and once under a camelCase name on the same
// columns. The camelCase twin stays (core's schema uses the same names), so
// dropping these loses no index. IF EXISTS keeps the step safe to re-run: it
// runs again whenever another program (MCP, the CLI) changes the schema.
const DUPLICATE_SNAKE_CASE_TASK_INDEXES: &[&str] = &[
    "idx_tasks_project_id",
    "idx_tasks_updated_at",
    "idx_tasks_deleted_at",
    "idx_tasks_due_date",
    "idx_tasks_start_time",
    "idx_tasks_review_at",
    "idx_tasks_created_at",
    "idx_tasks_status_deleted_at",
    "idx_tasks_project_status_deleted_at",
];

fn drop_duplicate_task_indexes(conn: &Connection) -> Result<(), String> {
    for name in DUPLICATE_SNAKE_CASE_TASK_INDEXES {
        conn.execute(&format!("DROP INDEX IF EXISTS {name}"), [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

2. Call it right after the schema text runs, so the camelCase twin always exists before its duplicate is dropped. In `initialize_sqlite_schema`, insert one line between `:506` and `:507`:

```rust
        transaction
            .execute_batch(SQLITE_SCHEMA)
            .map_err(|e| e.to_string())?;
        drop_duplicate_task_indexes(&transaction)?;
        ensure_orphan_section_tombstones_schema(&transaction)?;
```

3. Delete the ten lines `storage.rs:116-125` (the first CREATE block shown in "Current state") from `SQLITE_SCHEMA`. Leave exactly one blank line between the `);` that closes `CREATE TABLE IF NOT EXISTS tasks` and `CREATE TABLE IF NOT EXISTS projects (`. Do NOT touch the second block at `:282-293`.

4. Bump the version and its comment at `:40-43`:

```rust
// Version 9 drops the nine snake_case task indexes that duplicated camelCase ones. Increment this
// whenever SQLITE_SCHEMA or an ensure_* migration changes; otherwise the warm schema-state fast
// path can incorrectly skip the migration on an existing database.
const STORAGE_SCHEMA_VERSION: i64 = 9;
```

**Verify**: `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib duplicate_task_indexes` → 2 passed, 0 failed.

### Step 3: run the whole storage module

**Verify**: `CARGO_TARGET_DIR=/home/dd/worktrees/Mindwtr/cargo-target-shared rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib storage::` → 0 failed. Then `rtk git diff --check` → no output.

## Test plan

- Two new tests in `storage.rs` `mod tests`, written first and seen failing (Step 1): the version-8 migration test (drop, keep-one-per-column-set, tolerate core's extra indexes, keep data, record version 9, idempotent) and the new-database test.
- Structural pattern: `sqlite_open_migrates_version_six_projects_table_missing_start_date` (`storage.rs:6511`).
- Verification: the two commands in Steps 2 and 3.

## Done criteria

ALL must hold:

- [ ] `... cargo test ... --lib duplicate_task_indexes` → 2 passed.
- [ ] `... cargo test ... --lib storage::` → 0 failed.
- [ ] `/usr/bin/grep -c "CREATE INDEX IF NOT EXISTS idx_tasks_project_id" apps/desktop/src-tauri/src/storage.rs` prints `0`.
- [ ] `/usr/bin/grep -c "DROP INDEX IF EXISTS" apps/desktop/src-tauri/src/storage.rs` prints `1`.
- [ ] `/usr/bin/grep -n "const STORAGE_SCHEMA_VERSION: i64 = 9;" apps/desktop/src-tauri/src/storage.rs` prints one line.
- [ ] `rtk git status --short` shows only `apps/desktop/src-tauri/src/storage.rs`.
- [ ] `rtk git diff --check` prints nothing.

## STOP conditions

Stop and report (do not improvise) if:

- Any of the nine pairs in the live file differs from the table above in table, columns, column order, `UNIQUE`, or a `WHERE` clause. Report the pair; do not drop it.
- The excerpts in "Current state" do not match the live code, or `STORAGE_SCHEMA_VERSION` is no longer `8` (someone else bumped it: report, do not pick a number yourself).
- You find any code that names one of the nine snake_case indexes (for example `INDEXED BY`), in any language.
- Either new test passes in Step 1 before the production change.
- Any other test in `storage::` fails after Step 2 and the cause is not a whitespace mistake in the `SQLITE_SCHEMA` text you edited (several tests build old fixtures with `SQLITE_SCHEMA.replace(...)`, for example `:6515-6518` and `:6547-6555`; they must still find their substrings).
- A step's verification fails twice after a reasonable fix attempt, or the fix seems to need a file outside the scope list.

## Maintenance notes

- Recorded follow-up, NOT part of this plan: about 19 more task indexes across the Rust and core schemas serve no query or are covered by a longer index (for example `idx_tasks_projectId` beside `idx_tasks_project_status_deletedAt`). Retiring them needs `EXPLAIN QUERY PLAN` proof for the MCP sorted list query first.
- Anyone who adds an index here later: core (`packages/core/src/sqlite-schema.ts`) and this file share one database on desktop. Use the same name as core for the same columns, or the duplicate comes back under a new name.
- Reviewer: check that the `DROP` runs after `execute_batch(SQLITE_SCHEMA)`, that `idx_tasks_status` and the two `idx_people_*` snake_case indexes are untouched, and that the fixture writes the literal version `8`.
- A release-note line is not needed: there is no user-visible change. The first open after the update does nine quick `DROP INDEX` statements inside the existing open transaction.
