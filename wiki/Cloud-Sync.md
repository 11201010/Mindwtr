# Cloud Sync (Self-Hosted)

> **Note:** This page describes a **small sync server** only. It is **not** the Mindwtr app UI. Running this server (even in Docker) does not give you a hosted web app — it only provides a sync endpoint that desktop/mobile clients can point to. It uses file-based storage and is intended for single-machine, self-hosted use.

Mindwtr includes a minimal self-hosted Cloud Sync backend under `apps/cloud`. It stores one JSON file per token and is designed to be deployed behind your own HTTPS reverse proxy.

---

## Server Setup

You can run the server using **Docker** (recommended) or locally with Bun.

### Using Docker
See [[Docker Deployment]] for full instructions on running the Cloud Server with Docker Compose.

### Run Locally

From the repo root:

```bash
bun install
bun run --filter mindwtr-cloud dev -- --host 0.0.0.0 --port 8787
```

Or directly:

```bash
cd apps/cloud
bun run dev -- --host 0.0.0.0 --port 8787
```

### Configuration

| Variable                                | Default                  | Description |
| --------------------------------------- | ------------------------ | ----------- |
| `HOST`                                  | `0.0.0.0`                | Bind address |
| `PORT`                                  | `8787`                   | Server port |
| `MINDWTR_CLOUD_DATA_DIR`                | `<cwd>/data`             | Data directory |
| `MINDWTR_CLOUD_AUTH_TOKENS`             | _(unset)_                | Comma-separated bearer token allowlist |
| `MINDWTR_CLOUD_TOKEN`                   | _(legacy, deprecated)_   | Backward-compatible single-token alias |
| `MINDWTR_CLOUD_ALLOW_ANY_TOKEN`         | `false`                  | Explicit opt-in for token namespace mode (accept any bearer token) |
| `MINDWTR_CLOUD_CORS_ORIGIN`             | `http://localhost:5173`  | Allowed CORS origin (set explicitly in production) |
| `MINDWTR_CLOUD_RATE_WINDOW_MS`          | `60000`                  | Rate limit window |
| `MINDWTR_CLOUD_RATE_MAX`                | `120`                    | Max non-attachment requests per window |
| `MINDWTR_CLOUD_ATTACHMENT_RATE_MAX`     | `120`                    | Max attachment requests per window |
| `MINDWTR_CLOUD_RATE_CLEANUP_MS`         | `60000`                  | Rate-limit state cleanup interval |
| `MINDWTR_CLOUD_MAX_BODY_BYTES`          | `2000000`                | Max JSON request body size |
| `MINDWTR_CLOUD_MAX_ATTACHMENT_BYTES`    | `50000000`               | Max attachment upload size |
| `MINDWTR_CLOUD_MAX_TASK_TITLE_LENGTH`   | `500`                    | Max task title length |
| `MINDWTR_CLOUD_MAX_ITEMS_PER_COLLECTION`| `50000`                  | Max tasks/projects/sections/areas per payload |

---

## Endpoints

### Core Data

| Method | Endpoint   | Description |
| ------ | ---------- | ----------- |
| `GET`  | `/health`  | Health check → `{ ok: true }` |
| `GET`  | `/v1/data` | Read merged `AppData` for current token |
| `PUT`  | `/v1/data` | Merge incoming `AppData` into server state |

### Task API

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/v1/tasks` | List tasks. Query params: `query`, `all=1`, `deleted=1`, `status=<inbox|next|waiting|someday|reference|done|archived>` |
| `POST` | `/v1/tasks` | Create task. Supports `{ title, input, props }` where `input` is quick-add text |
| `GET` | `/v1/tasks/:id` | Get one task by id |
| `PATCH` | `/v1/tasks/:id` | Update task fields |
| `DELETE` | `/v1/tasks/:id` | Soft-delete task |
| `POST` | `/v1/tasks/:id/complete` | Mark task as `done` |
| `POST` | `/v1/tasks/:id/archive` | Mark task as `archived` |

### Project/Search API

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/v1/projects` | List non-deleted projects |
| `GET` | `/v1/search?query=...` | Full-text search across tasks/projects |

### Attachment API

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `GET` | `/v1/attachments/:path` | Download attachment bytes |
| `PUT` | `/v1/attachments/:path` | Upload/replace attachment bytes |
| `DELETE` | `/v1/attachments/:path` | Delete attachment (idempotent) |

Notes:
- All `/v1/*` endpoints require `Authorization: Bearer <token>`.
- Attachment paths are validated to prevent traversal; use relative paths only.
- `405` is returned for unsupported methods; `429` for rate limiting.

### Authentication

Use a bearer token:

```
Authorization: Bearer <token>
```

The server hashes the token (SHA-256) and uses it as the filename, so each token maps to one data file.

By default, you should configure an allowlist with `MINDWTR_CLOUD_AUTH_TOKENS` (or legacy `MINDWTR_CLOUD_TOKEN`).

If you intentionally want **token namespace mode**, set:

```bash
MINDWTR_CLOUD_ALLOW_ANY_TOKEN=true
```

In namespace mode:
- Any valid non-empty bearer token is accepted.
- Each token maps to its own namespace/file.
- Only use this behind trusted private network controls.

---

## Client Setup

In **Settings → Sync**:

1. Set **Sync Backend** to **Cloud**
2. Set **Cloud URL** to `https://your-domain.example/v1` (Mindwtr will append `/data`)
3. Set **Access Token** to any long random string you control

---

## Security Notes

- The cloud server does **not** enforce HTTPS; deploy behind an HTTPS reverse proxy
- Set `MINDWTR_CLOUD_CORS_ORIGIN` for production deployments (default only allows `http://localhost:5173`)
- Treat the bearer token like a password (anyone with it can read/write your data)

---

## See Also

- [[Data and Sync]]
- [[Dropbox Sync]]
- iCloud Drive users: use **File Sync** with both `data.json` and `attachments/` (not the Cloud endpoint)
- [[Developer Guide]]
