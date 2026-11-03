# AGENTS.md

## Language

- Write commit descriptions, PR/Issue titles and bodies, code comments/docstrings, and documents in English.
- Exceptions: end-user-facing UI text (the Japanese labels in `view/script.js`), Japanese data patterns/fixtures, quotations, technical identifiers, and the Japanese fork-PR approval comment in `.github/workflows/docker.yml` (its `body-includes: Environment 承認待ち` match key must stay identical to the comment heading).
- Keep `package.json` fields in English.
- Error messages are in English.
- Log messages carry a leading emoji matched to the content (🔄 ❌ ✅ 📃, as in `src/main.ts` and `src/server.ts`).
- Commits follow Conventional Commits; branches follow Conventional Branch (`feat/`, `fix/`, ...).
- Do not push additional commits to Renovate-created PRs.

## Overview

A Fastify + TypeScript web server that exposes a VRCX SQLite database as a read-only HTTP API, together with a small Vue/Vuetify viewer (`view/`) served as static files. The package manager is pnpm (Node.js version in `.node-version`).

## Commands

```bash
pnpm install        # install dependencies
pnpm dev            # watch mode (tsx watch src/main.ts)
pnpm start          # run (tsx src/main.ts)
pnpm build          # tsc -p tsconfig.json (outputs to dist/)
pnpm lint           # Prettier check + ESLint + tsc
pnpm fix            # Prettier write + ESLint --fix
```

There are no tests. Verify changes with `pnpm lint` and by running the server against a SQLite file.

## Architecture

- `src/main.ts`: entry point; reads `ENV` and starts the server.
- `src/server.ts`: builds the Fastify app (CORS, routers).
- `src/environments.ts`: the `ENV` object, the only way to read environment variables.
- `src/endpoints/index.ts`: abstract `BaseRouter`; add endpoints by subclassing it and registering the router in `server.ts`.
- `src/endpoints/api.ts`: `GET /api/` (table list with row counts) and `GET /api/:tableName?page=&limit=` (records, newest `rowid` first).
- `src/endpoints/root.ts`: serves `view/index.html` and `view/script.js` only.
- `view/`: static viewer, copied into the Docker image.

### Environment variables

| Name | Default | Description |
| --- | --- | --- |
| `API_HOST` | `0.0.0.0` | Listen host |
| `API_PORT` | `8000` (the Docker image sets `80`) | Listen port |
| `VRCX_SQLITE_FILEPATH` | `C:\Users\<USERNAME>\AppData\Roaming\VRCX\VRCX.sqlite3` (built from `%USERNAME%`) | Path to the VRCX database |

## Safety rules and invariants

- Open the database with `readonly: true` only; never add write operations.
- Table names are interpolated into SQL only after being matched against the names returned from `sqlite_master`, and always through `quoteIdentifier`. `limit` / `offset` are bound parameters (`LIMIT ? OFFSET ?`), never interpolated.
- Validate `page` / `limit` with both the query schema and `calculateOffset` (safe integers, `limit` <= `MAX_LIMIT`); invalid input returns 400.
- Close the `better-sqlite3` connection on every path (all DB work stays inside the `try` of `routeGet`, closed in `finally`).
- `root.ts` serves only files listed in `SERVABLE_FILES`; do not serve arbitrary paths from `view/`.
- Do not add `skipLibCheck` to `tsconfig.json`.
- Read configuration through `ENV`; do not hard-code DB paths or secrets, and do not log personal or credential data.
- Write JSDoc in English for functions and interfaces.
- Do not commit files containing secrets.
- When commands, environment variables, or architecture change, update `AGENTS.md`, `.github/copilot-instructions.md`, and the README environment table.
