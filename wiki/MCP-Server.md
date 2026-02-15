# MCP Server

Mindwtr provides an optional **MCP (Model Context Protocol)** server. This allows you to connect AI agents (like **Claude Desktop**, **Claude Code**, **OpenAI Codex**, or **Gemini CLI**) directly to your local Mindwtr database.

This is a **local stdio** server (no HTTP). MCP clients launch it as a subprocess and talk over JSON‑RPC on stdin/stdout.

---

## Requirements

- **Node.js 18+** (for the MCP client that spawns the server)
- **Bun** (recommended for running/building the server)
- A local Mindwtr database (`mindwtr.db`)

### Default Database Locations
- **Linux:** `~/.local/share/mindwtr/mindwtr.db`
- **macOS:** `~/Library/Application Support/mindwtr/mindwtr.db`
- **Windows:** `%APPDATA%\mindwtr\mindwtr.db`

You can override the database location with:
- `--db /path/to/mindwtr.db`
- Environment variable: `MINDWTR_DB_PATH` or `MINDWTR_DB`

---

## Setup & Configuration

MCP clients run the server as a subprocess. You point them to **the command** and pass arguments.

### Key Arguments
- `--db "/path/to/mindwtr.db"`: Path to your SQLite database.
- `--write`: Enable write operations (add, update, complete, delete). **Without this flag, the server is read-only.**

### 1. Claude Desktop
Add a server entry to your Claude Desktop configuration file.
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "bun",
      "args": [
        "/absolute/path/to/Mindwtr/apps/mcp-server/src/index.ts",
        "--db",
        "/home/dd/.local/share/mindwtr/mindwtr.db",
        "--write"
      ]
    }
  }
}
```
*Note: Replace `/absolute/path/to/Mindwtr` and the DB path with your actual paths.*

### 2. Claude Code (CLI)
You can add the server via the CLI:

```bash
claude mcp add mindwtr -- \
  bun /path/to/Mindwtr/apps/mcp-server/src/index.ts --db "/path/to/mindwtr.db" --write
```

### 3. Gemini CLI
Gemini CLI uses `settings.json` (User: `~/.gemini/settings.json` or Project: `.gemini/settings.json`).

**Command Line:**
```bash
gemini mcp add mindwtr \
  bun /absolute/path/to/Mindwtr/apps/mcp-server/src/index.ts \
  --db "/path/to/mindwtr.db" --write
```

**Manual Config:**
```json
{
  "mcpServers": {
    "mindwtr": {
      "command": "bun",
      "args": ["/absolute/path/to/Mindwtr/apps/mcp-server/src/index.ts", "--db", "/path/to/mindwtr.db", "--write"]
    }
  }
}
```

---

## Running Manually

You usually don't need to run this manually (the MCP client does it), but it's useful for testing.

### From Source (Bun)
```bash
# Read-only
bun run mindwtr:mcp -- --db "/path/to/mindwtr.db"

# With write access
bun run mindwtr:mcp -- --db "/path/to/mindwtr.db" --write
```

### Build & Run (Node)
```bash
# Build
bun run --filter mindwtr-mcp-server build

# Run
node apps/mcp-server/dist/index.js --db "/path/to/mindwtr.db"
```

---

## Available Tools

When connected, the AI agent has access to these tools. By default the server is **read-only**; pass `--write` to enable any write tool.
Only `--write` is supported for write access (no alternate aliases).

| Tool | Operation | Requires `--write` |
| --- | --- | --- |
| `mindwtr.list_tasks` | List tasks | No |
| `mindwtr.list_projects` | List projects | No |
| `mindwtr.get_task` | Fetch one task by ID | No |
| `mindwtr.add_task` | Create task | Yes |
| `mindwtr.update_task` | Update task | Yes |
| `mindwtr.complete_task` | Mark done | Yes |
| `mindwtr.delete_task` | Soft-delete task | Yes |
| `mindwtr.restore_task` | Restore task | Yes |

### Read Tools
- **`mindwtr.list_tasks`**: List tasks with filters (status, project, date range, search).
- **`mindwtr.list_projects`**: List all projects.
- **`mindwtr.get_task`**: Get details of a specific task by ID.

### Write Tools (Requires `--write`)
- **`mindwtr.add_task`**: Create a new task. Supports natural language `quickAdd` (e.g., "Buy milk @errands /due:tomorrow").
- **`mindwtr.update_task`**: Update an existing task (supports clearing fields with `null`).
- **`mindwtr.complete_task`**: Mark a task as done.
- **`mindwtr.delete_task`**: Soft-delete a task.
- **`mindwtr.restore_task`**: Restore a soft-deleted task.

---

## Tool Reference

All tools return JSON in the `content.text` field. Parse the JSON to get the actual payload.

### `mindwtr.list_tasks`
**Input fields**
- `status`: `inbox | next | waiting | someday | done | archived`
- `projectId`: string
- `includeDeleted`: boolean
- `limit`: number
- `offset`: number
- `search`: string
- `dueDateFrom`: ISO string
- `dueDateTo`: ISO string
- `sortBy`: `updatedAt | createdAt | dueDate | title | priority`
- `sortOrder`: `asc | desc`

**Example**
```json
{
  "status": "next",
  "limit": 20,
  "offset": 0,
  "sortBy": "updatedAt",
  "sortOrder": "desc"
}
```

**Response**
```json
{
  "tasks": [
    {
      "id": "task-uuid",
      "title": "Follow up with design",
      "status": "next",
      "updatedAt": "2026-01-25T03:45:57.246Z"
    }
  ]
}
```

### `mindwtr.list_projects`
**Input fields**
- none

**Response**
```json
{
  "projects": [
    {
      "id": "project-uuid",
      "title": "Mindwtr",
      "status": "active"
    }
  ]
}
```

### `mindwtr.get_task`
**Input fields**
- `id`: string (task UUID)
- `includeDeleted`: boolean (optional)

**Example**
```json
{ "id": "task-uuid" }
```

### `mindwtr.add_task` (write)
**Input fields**
- `title`: string (required if `quickAdd` omitted)
- `quickAdd`: string (required if `title` omitted)
- `status`: `inbox | next | waiting | someday | done | archived`
- `projectId`: string
- `dueDate`: ISO string
- `startTime`: ISO string
- `contexts`: string[]
- `tags`: string[]
- `description`: string
- `priority`: string
- `timeEstimate`: string (e.g. `30m`, `2h`)

**Example**
```json
{
  "quickAdd": "Send invoice +Acme /due:tomorrow 9am #finance"
}
```

### `mindwtr.update_task` (write)
**Input fields**
- `id`: string (task UUID)
- `title`, `status`, `projectId`, `dueDate`, `startTime`, `contexts`, `tags`, `description`, `priority`, `timeEstimate`, `reviewAt`, `isFocusedToday`

**Notes**
- Use `null` to clear fields like `projectId`, `dueDate`, `startTime`, `contexts`, and `tags`.

**Example**
```json
{
  "id": "task-uuid",
  "status": "waiting",
  "reviewAt": "2026-01-27T09:00:00.000Z"
}
```

### `mindwtr.complete_task` (write)
**Input fields**
- `id`: string (task UUID)

### `mindwtr.delete_task` (write)
**Input fields**
- `id`: string (task UUID)

### `mindwtr.restore_task` (write)
**Input fields**
- `id`: string (task UUID)

---

## Output Format Notes

- Tool outputs are JSON strings, not structured MCP values. Your client should parse `content[0].text`.
- Task/project IDs are UUIDs from the local SQLite database.
- Dates are ISO 8601 strings (UTC).

---

## Safety & Notes

- **Concurrency:** The server uses SQLite WAL mode. Writes may fail if the DB is locked; clients are expected to retry.
- **Shared Logic:** Write operations use the shared `@mindwtr/core` library to ensure business rules are enforced.
- **Keep-Alive:** The server stays alive as long as `stdin` is open.

## Troubleshooting

- **"Command not found"**: `mindwtr-mcp` is not a global command. Use `bun run mindwtr:mcp` or the full path to the built script.
- **Client Connection Issues**: Ensure you are NOT using `bun run` as the command in your MCP client config, as it may output extra text. Run `bun` directly on the source file or `node` on the built file.
