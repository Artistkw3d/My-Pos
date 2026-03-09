# CLAUDE.md - My-Pos (Docker/Server Deployment)

## Communication
- Always respond in English only. The user's terminal does not support Arabic text.

## Project Overview

My-Pos is the Docker/server deployment version of the POS Offline system. It is a Flask-only backend with the same frontend, designed to run in Docker containers. It is periodically synced from the main Pos-Offline repo.

**App ID**: `com.pos.offline`
**Currency**: Kuwaiti Dinar (KD)

## Cross-Repo & Cross-Platform Sync Policy

**CRITICAL: On every change, you MUST ask the user:**

> "This change affects [describe scope]. Should I also apply it to:"
> 1. **Pos-Offline repo** (main repo at `/home/artistkw/Pos-Offline`)?
> 2. **Electron/Windows desktop app** (electron/server.js + routes/*.js in Pos-Offline)?
> 3. **Android/Capacitor app** (rebuild APK in Pos-Offline)?

The two repos (Pos-Offline and My-Pos) share the same frontend, SQLite schema, and REST API contract but have different backend structures. Changes must be adapted when syncing:
- `server.py` in My-Pos uses modular `db_modules/` → must be adapted to Pos-Offline's monolithic `server.py`
- `frontend/` changes → must be copied to Pos-Offline's `frontend/` as-is
- `setup_database.py` schema changes → must be applied to both repos
- Pos-Offline has `electron/`, `routes/`, and Node.js Express — those need updating too for Electron

### Platform build checklist
After applying changes, remind the user if any platform needs rebuilding:
- **Docker**: `docker build` in this repo
- **Electron (.exe)**: `npm run electron:build` in Pos-Offline repo
- **Android (.apk)**: `npx cap sync android && gradlew assembleDebug` in Pos-Offline repo
- **PWA**: Update `frontend/sw.js` version if caching changed

## Repositories

| Repo | URL | Purpose |
|------|-----|---------|
| **My-Pos** (this repo) | `https://github.com/Artistkw3d/My-Pos.git` | Docker/server deployment — Flask-only. Modularized DB layer (`db_modules/`). Date-based subscription enforcement. |
| **Pos-Offline** | `https://github.com/Artistkw3d/Pos-Offline.git` | Main/canonical — Electron + Flask + frontend. Has both Node.js Express server and Python Flask server. JWT-based license enforcement. |

### Key Differences From Pos-Offline

- This repo has a modularized DB layer: `db_modules/schema.py`, `db_modules/master.py`, `db_modules/migrate.py`
- This repo does NOT have `electron/`, `routes/`, or Node.js Express — it's Flask-only for Docker
- This repo uses simple date-based subscription enforcement (not JWT)
- Both repos share the same `frontend/` code, SQLite schema, and REST API contract

## Architecture

```
                    +---------------------------+
                    |     frontend/ (SPA)       |
                    |  Vanilla JS + HTML + CSS  |
                    +-----------+---------------+
                                | REST API (/api/*)
                                v
                       server.py (Flask)
                       Python 3.11, Port 5000
                                |
                    +-----------+-----------+
                    |                       |
              db_modules/             database/
              schema.py               pos.db (default)
              master.py               master.db (tenants)
              migrate.py              tenants/<slug>.db
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask 3.0.0, Flask-CORS |
| Database | SQLite3 (33 tables, per-tenant isolation) |
| Frontend | Vanilla JavaScript (ES6+), HTML5, CSS3 (no framework) |
| Deployment | Docker (Python 3.11 slim), nginx-proxy |

## Directory Structure

```
/
+-- server.py               # Flask REST API server
+-- setup_database.py       # DB schema initialization
+-- requirements.txt        # Python deps
+-- Dockerfile              # Python 3.11 slim, port 5000
+-- docker-compose.yml      # Docker compose with nginx-proxy
|
+-- db_modules/             # Modularized database layer
|   +-- schema.py           # Table creation & schema
|   +-- master.py           # Master DB (tenants, super admins)
|   +-- migrate.py          # Schema migrations
|
+-- frontend/               # All client-side code (SPA)
|   +-- index.html          # Main HTML (RTL Arabic)
|   +-- app.js              # Main application logic
|   +-- style.css           # Styles with dark mode
|   +-- localdb.js          # IndexedDB wrapper
|   +-- sync-manager.js     # Server sync logic
|   +-- sw.js               # Service Worker
|   +-- manifest.json       # PWA manifest
|   +-- products-search.js  # Product/barcode search
|   +-- customers_fix.js    # Customer sync utilities
|   +-- accounting.html     # Accounting reports
|
+-- database/               # SQLite databases (runtime)
```

## Development Commands

```bash
pip install -r requirements.txt       # Install Python deps
python setup_database.py              # Initialize database schema
python server.py                      # Run Flask on port 5000
```

### Docker
```bash
docker build -t my-pos .              # Build image
docker run -d -p 5000:5000 my-pos     # Run container
docker compose up -d                  # Run with docker-compose
```

## Modular Architecture & Feature Flags (Planned Restructure)

### Overview
The codebase is being restructured from monolithic files into a modular, plugin-based architecture with a feature flags system controlled by Super Admin per tenant. See Pos-Offline CLAUDE.md for full architecture details.

### Database Migration System
Instead of scattered `ALTER TABLE ... ADD COLUMN` in try/except blocks, use a versioned migration system:
- Migration files in `database/migrations/NNN_description.sql`
- A `db_version` table tracks applied migrations
- On server startup: check version -> run only NEW migrations
- Migrations only ADD — never delete or rename existing data
- In My-Pos, migration logic lives in `db_modules/migrate.py`

### Feature Flags System (Per-Tenant)
A `tenant_features` table in `master.db` controls which features are enabled per store:
```sql
CREATE TABLE tenant_features (
    tenant_id TEXT,
    feature_key TEXT,
    enabled INTEGER DEFAULT 0,
    enabled_at TEXT,
    PRIMARY KEY (tenant_id, feature_key)
);
```
- Super Admin UI toggles features per store
- Backend blocks API calls for disabled features (403)
- Data is NEVER deleted when a feature is toggled off

### Plugin vs System Update Rule
**CRITICAL: When adding ANY new feature, you MUST ask the user:**

> "Is this a **plugin** (feature flag) or a **system update**?"

- **Plugin (user says "yes")**: Toggleable module. Super Admin controls per store.
- **System Update (user says "no")**: Core change. Applies to ALL stores. Always active.

### Frontend Modules
Frontend is being split from monolithic `app.js` into `frontend/modules/` folders. Each module = self-contained feature with its own JS + HTML. See Pos-Offline CLAUDE.md for full directory structure.

## Important Files to Change Together

When modifying the API:
1. `server.py` — Flask routes
2. `db_modules/` — If DB operations change
3. `frontend/app.js` — Frontend API calls
4. **Pos-Offline repo**: `server.py` + `electron/server.js` + `routes/*.js`

When modifying the database schema:
1. `setup_database.py` — Fresh install schema
2. `db_modules/schema.py` — Table creation
3. `db_modules/migrate.py` — Migrations
4. **Pos-Offline repo**: `setup_database.py` + `server.py` + `electron/server.js`

When modifying the frontend:
1. `frontend/app.js` — Main logic
2. `frontend/index.html` — HTML structure and modals
3. `frontend/style.css` — Styling
4. `frontend/sw.js` — Update service worker version if caching changes
5. **Pos-Offline repo**: Copy the same `frontend/` changes

## Key Conventions

### Multi-Tenancy
- Tenant isolation via `X-Tenant-ID` HTTP header on all `/api/*` requests
- Each tenant gets a separate SQLite database at `database/tenants/<slug>.db`
- `database/master.db` stores tenant metadata and super admin accounts

### API Pattern
- Base path: `/api/<resource>`
- Methods: standard REST (GET, POST, PUT, DELETE)
- Response format: `{ "success": true/false, "data": ..., "error": "..." }`
- Error messages are in Arabic

### Security Notes
- Passwords are hashed with SHA-256
- Default super admin: username `superadmin`, password `admin123` — change in production
- Tenant slugs are sanitized: `slug.replace(/[^a-zA-Z0-9_-]/g, '')`
