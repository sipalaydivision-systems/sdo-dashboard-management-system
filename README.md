# Dashboard Management System

Unified monitoring and account management for the Schools Division of Sipalay City systems on Railway.

One screen showing live KPIs across all five division systems, with its own role-based accounts.

## Monitored Systems

| System | What it reports | Database | How it's read |
|---|---|---|---|
| **CPES** | Users, transmittals, partners, donations, research | PostgreSQL | Direct, read-only |
| **DCPMS** | Equipment records, schools, personnel, pending requests | SQLite | Stats endpoint (see below) |
| **SDO Website** | Content tables and row counts | MySQL | Direct, read-only |
| **SRQ** | **No. of requestors and type of request** | PostgreSQL | Direct, read-only |
| **Leave App** | **No. of applicants**, status, leave type | PostgreSQL | Direct, read-only |

## Safety Model

The dashboard **cannot modify any monitored system**. This is enforced by the database:

- PostgreSQL sessions run with `default_transaction_read_only=on`
- MySQL sessions run with `SET SESSION TRANSACTION READ ONLY`
- DCPMS only ever exposes `SELECT COUNT` aggregates

Every query is capped by `QUERY_TIMEOUT_MS` (default 8s) and results are cached for `STATS_CACHE_TTL_MS` (default 60s).

## Accounts

Dashboard accounts are **separate** from the five systems' own user accounts.

| Role | Capabilities |
|---|---|
| **Administrator** | Full access to every system panel, plus account management |
| **Viewer** | Read-only dashboard; may be restricted to specific systems |

## Project Structure

```
src/
  config.js              System registry and env parsing
  server.js              Express app, sessions, security headers, boot
  db/
    dashboard.js         Dashboard users, sessions, audit log
    pools.js             Read-only pools for monitored systems
  services/
    collectors.js        Per-system stat queries
    stats.js             Aggregation, caching, fault isolation
  routes/api.js          JSON API
  middleware/auth.js     Session loading, role gates
public/                  UI (no build step, no external requests)
```

## Deployment on Railway

1. Set required variables in Railway dashboard
2. Connect monitored systems via environment variables
3. Generate a domain for public access
4. Sign in with initial admin credentials

See README for detailed setup instructions.