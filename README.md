# passmark-api

Cloudflare Workers project that:
- Scrapes PassMark CPU scores daily via Cron Trigger.
- Stores snapshots in Cloudflare R2.
- Exposes a public HTTP API with fuzzy CPU name lookup.
- Supports Cloudflare Browser Rendering fallback when direct fetch is blocked.

## Requirements

- Node.js 20+
- Yarn 1.x or Yarn Berry
- Cloudflare account with Workers + R2 enabled

## Setup

1. Install dependencies:

```bash
yarn install
```

2. Create R2 bucket(s):

```bash
wrangler r2 bucket create passmark-cpu-scores
wrangler r2 bucket create passmark-cpu-scores-preview
```

3. Authenticate Wrangler:

```bash
wrangler login
```

4. Set optional admin token used by `POST /v1/admin/scrape`:

```bash
wrangler secret put ADMIN_TOKEN
```

5. (Optional) change bucket names and source URL in `wrangler.toml`.

6. Ensure Browser Rendering is enabled for your account (needed for fallback and browser checks).

7. Admin HTTP endpoints are disabled by default in production.
Use cron triggers for real ingestion. For local testing only, enable:

```bash
yarn wrangler dev --var ENABLE_TEST_ENDPOINTS:true
```

## Local development

```bash
yarn dev
```

## Test

```bash
yarn test
```

## Deploy

```bash
yarn deploy
```

## Cron schedule

Configured in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

Runs every day at 03:00 UTC.

## API

- `GET /health`
- `GET /v1/snapshots/latest`
- `GET /v1/snapshots/:date` (`YYYY-MM-DD`)
- `GET /v1/cpus?query=<name>&limit=5`
- `GET /v1/cpus/all`
- `GET /v1/cpus/:id`
- `POST /v1/admin/scrape` (manual scrape trigger)
- `GET /v1/admin/browser-check?url=<url>` (verify Browser Rendering)

`/v1/admin/*` is test-only and returns `403` unless `ENABLE_TEST_ENDPOINTS=true` (or localhost runtime).

### Example

```bash
curl "https://<your-worker-domain>/v1/cpus?query=ryzen%205600&limit=3"
```

```bash
curl -X POST "https://<your-worker-domain>/v1/admin/scrape" \\
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```

## Data shape

Stored snapshot JSON in R2 (`snapshots/YYYY-MM-DD.json` and `snapshots/latest.json`):

```json
{
  "generatedAt": "2026-02-15T03:00:00.000Z",
  "date": "2026-02-15",
  "sourceUrl": "https://www.cpubenchmark.net/cpu_list.php",
  "total": 1000,
  "cpus": [
    {
      "id": "amd-ryzen-9-9950x-49120",
      "name": "AMD Ryzen 9 9950X",
      "cpuMark": 49120,
      "rank": 1,
      "sourceUrl": "https://www.cpubenchmark.net/cpu.php?cpu=AMD+Ryzen+9+9950X"
    }
  ]
}
```
