# vrcx-web-server

A web server that exposes a [VRCX](https://github.com/vrcx-team/VRCX) SQLite database as a read-only HTTP API, with a small viewer UI.

## Usage

```bash
pnpm install
VRCX_SQLITE_FILEPATH=/path/to/VRCX.sqlite3 pnpm start
```

The server listens on `0.0.0.0:8000` by default and serves the viewer at `/`.

| Environment variable | Default | Description |
| --- | --- | --- |
| `API_HOST` | `0.0.0.0` | Listen host |
| `API_PORT` | `8000` (`80` in the Docker image) | Listen port |
| `VRCX_SQLITE_FILEPATH` | `C:\Users\<USERNAME>\AppData\Roaming\VRCX\VRCX.sqlite3` | Path to the VRCX database |

### API

- `GET /api/`: list tables with their row counts.
- `GET /api/:tableName?page=1&limit=10`: list records, newest first. `limit` is at most 1000; invalid values return 400.

### Docker

`compose.yaml` publishes port 3000 and reads environment variables from `.env`; mount your database under `./data` and set `VRCX_SQLITE_FILEPATH=/data/<file>`.

## License

MIT
