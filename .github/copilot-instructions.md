# GitHub Copilot Instructions

Review guidance only. Project overview, commands, and safety invariants are in [AGENTS.md](../AGENTS.md); reviews should be written in English.

## Review focus

- **SQL interpolation**: only table names are interpolated, after matching against names from `sqlite_master` and quoting with `quoteIdentifier`. `page` / `limit` must stay bound parameters validated by the query schema and `calculateOffset` (invalid input returns 400). Check that any new or changed query keeps this.
- **Read-only**: the database must be opened with `readonly: true`; flag any write operation.
- **Secrets**: DB paths and credentials come from `ENV` (`src/environments.ts`), and nothing sensitive is logged.
- **Connection close**: the `better-sqlite3` connection must be closed on every path, including early returns and exceptions.
- **Static files**: `root.ts` must serve only files in `SERVABLE_FILES`.
- `tsconfig.json` must not gain `skipLibCheck`.

## Known patterns not to flag

- Table-name interpolation that is matched against real table names and quoted is not a vulnerability.
- The absence of tests is a known state; do not leave comments that only point out missing tests.
