# CLAUDE.md

See `AGENTS.md` for full agent spec.

## APS CLI — Key context

Autodesk Platform Services CLI for ACC (Autodesk Construction Cloud) operations.
Private fork: `ultraknock/aps-cli` (push to `private` remote, NOT `origin` → adskdimitrii).

## Auth

- 3-legged cached token via `getAccessToken()` — works for data:read/write/create/search
- SSA JWT is broken (invalid_scope) — don't use it
- Token may need periodic refresh (no auto-refresh implemented)

## Key commands

- `aps asset *` — ACC Assets API (batch-create, list, update)
- `aps recap *` — Reality Capture API (create/process/status/result)
- `aps file viewer-urn` — resolve ACC URL or item-id to base64url viewer URN
- `aps locations *` — ACC Locations API
- `aps sheets *` — ACC Sheets API
- `aps url <acc-url>` — resolve ACC browser URL to hub/project IDs

## ACC constraints

- .rcp (ReCap) files: NOT supported by Model Derivative. View-only via browser or ReCap desktop.
- Batch-create assets: POST `/construction/assets/v2/projects/b.{id}/assets:batch-create`
- Requires statusId from the asset lifecycle set

## NN26 project IDs

- ACC project: `1a9e7f24-5bd3-4491-afbc-110d72192f17`
- NN25 hub: `73ac077d-55c0-4804-8e70-03674a9763be`

## Running locally

```bash
node src/index.ts <command>
# or after build:
./bin/aps <command>
```
