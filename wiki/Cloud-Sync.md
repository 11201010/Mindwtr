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

| Method | Endpoint   | Description                                  |
| ------ | ---------- | -------------------------------------------- |
| `GET`  | `/health`  | Health check → `{ ok: true }`                |
| `GET`  | `/v1/data` | Returns your `AppData` JSON (requires auth)  |
| `PUT`  | `/v1/data` | Replaces your `AppData` JSON (requires auth) |

### Authentication

Use a bearer token:

```
Authorization: Bearer <token>
```

The server hashes the token (SHA-256) and uses it as the filename, so each token maps to one data file.

If `MINDWTR_CLOUD_AUTH_TOKENS` is unset, the server runs in **token namespace mode**:

- Any non-empty bearer token is accepted.
- Each token maps to its own namespace/file.
- This mode is only safe behind trusted network controls (VPN/firewall/private reverse proxy).

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
- [[Developer Guide]]
