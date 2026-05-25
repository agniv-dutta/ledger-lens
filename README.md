# ledger-lens

ledger-lens is a Node.js + Express + MongoDB reconciliation service for comparing user and exchange transaction exports, flagging quality issues, matching rows with configurable tolerances, and producing run-scoped reports.

## Architecture

The application is organized as a straight pipeline:

1. The API layer accepts a reconciliation request and returns a run id immediately.
2. The runner orchestrates ingestion, matching, and report persistence in sequence.
3. Ingestion streams CSV input, validates each row, and upserts it into MongoDB with a `runId` partition key.
4. Matching loads the run-scoped rows into memory, applies asset/type normalization, and greedily pairs transactions.
5. Reporting stores the reconciliation results and exposes them through read-only report endpoints.

Think of the architecture as:

`Client -> Express API -> Reconciliation Runner -> Ingestion -> Matching -> Report Writer -> MongoDB`

The data model is partitioned by `runId`, so multiple reconciliation runs can coexist without polluting each other.

## Prerequisites

- Node.js 18 or newer
- MongoDB 6 or newer

## Setup

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Set `MONGODB_URI`, `PORT`, `TIMESTAMP_TOLERANCE_SECONDS`, `QUANTITY_TOLERANCE_PCT`, and `LOG_LEVEL` as needed.
4. Install dependencies with `npm install`.
5. Start the service with `npm run dev`.

Example:

```bash
cp .env.example .env
npm install
npm run dev
```

## Deployment

1. Create a free MongoDB Atlas cluster, whitelist `0.0.0.0/0`, and copy the connection string.
2. Connect the GitHub repository to Render and create a new Web Service.
3. Add `MONGODB_URI` in Render's Environment tab.
4. Push to `main` and Render will auto-deploy.
5. Test the deployment with `curl https://<your-render-url>/health`.

## Docker

Build and start the service with MongoDB using Docker Compose:

```bash
docker compose up --build
```

The app listens on port `3000` and connects to the bundled MongoDB container.

## Triggering A Reconciliation Run

Submit a CSV reconciliation job with `POST /reconcile`. The request is asynchronous: the API responds with `202 Accepted` and the caller polls the report endpoints until the run completes.

```bash
curl -X POST http://localhost:3000/reconcile \
  -H "Content-Type: application/json" \
  -d '{
    "timestampToleranceSeconds": 300,
    "quantityTolerancePct": 0.01,
    "userFilePath": "./data/user.csv",
    "exchangeFilePath": "./data/exchange.csv"
  }'
```

Example response:

```json
{
  "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
  "status": "pending",
  "message": "Reconciliation started"
}
```

## API Endpoints

### POST /reconcile

Starts a reconciliation run in the background.

Request body fields are optional:

```json
{
  "timestampToleranceSeconds": 300,
  "quantityTolerancePct": 0.01,
  "userFilePath": "./data/user.csv",
  "exchangeFilePath": "./data/exchange.csv"
}
```

Response:

```json
{
  "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
  "status": "pending",
  "message": "Reconciliation started"
}
```

### GET /report/:runId

Returns the completed run metadata and every reconciliation report row for that run.

Example response:

```json
{
  "run": {
    "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
    "status": "completed",
    "summary": {
      "matched": 15,
      "conflicting": 1,
      "unmatched_user": 0,
      "unmatched_exchange": 2,
      "total": 18
    },
    "config": {
      "timestampToleranceSeconds": 300,
      "quantityTolerancePct": 0.01
    },
    "startedAt": "2026-05-23T08:00:00.000Z",
    "completedAt": "2026-05-23T08:00:08.000Z"
  },
  "reports": [
    {
      "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
      "category": "matched",
      "userTx": {
        "transactionId": "USR-012"
      },
      "exchangeTx": {
        "transactionId": "EXC-1012"
      },
      "reason": null,
      "diffDetails": {
        "quantityDiff": 0.0001,
        "quantityDiffPct": 0.0003333333333333333,
        "timestampDiffSeconds": 5
      }
    }
  ]
}
```

### GET /report/:runId/export

Streams the reconciliation report as CSV directly in the HTTP response.

Response headers:

- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="reconciliation-<runId>.csv"`

### GET /runs

Returns a paginated list of reconciliation runs.

Query parameters:

- `page` - defaults to `1`
- `limit` - defaults to `20`, maximum `100`
- `status` - optional filter by `pending`, `running`, `completed`, or `failed`

Example response:

```json
{
  "total": 12,
  "page": 1,
  "limit": 20,
  "runs": [
    {
      "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
      "status": "completed",
      "summary": {
        "matched": 15,
        "conflicting": 1,
        "unmatched_user": 0,
        "unmatched_exchange": 2,
        "total": 18
      },
      "startedAt": "2026-05-23T08:00:00.000Z",
      "completedAt": "2026-05-23T08:00:08.000Z"
    }
  ]
}
```

### GET /health

Returns the service health and process uptime.

Example response:

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-05-26T12:34:56.789Z"
}
```

### GET /report/:runId/summary

Returns only the run status and summary counts.

Example response:

```json
{
  "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
  "status": "completed",
  "summary": {
    "matched": 16,
    "conflicting": 1,
    "unmatched_user": 2,
    "unmatched_exchange": 2,
    "total": 21
  }
}
```

### GET /report/:runId/unmatched

Returns only unmatched rows. Optional query parameter `source=user|exchange` narrows the result set.

Examples:

```bash
curl http://localhost:3000/report/cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91/unmatched
curl "http://localhost:3000/report/cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91/unmatched?source=user"
```

Example response:

```json
{
  "runId": "cda7d2f3-4c1d-4eb2-9df1-62f9a0ccfa91",
  "reports": [
    {
      "category": "unmatched_user",
      "reason": "flagged during ingestion: Missing or unparseable timestamp",
      "userTx": {
        "transactionId": "USR-018"
      },
      "exchangeTx": null
    }
  ]
}
```

## Configuration Reference

| Variable | Default | Description |
| --- | --- | --- |
| `TIMESTAMP_TOLERANCE_SECONDS` | `300` | Maximum allowed timestamp drift between matched rows. |
| `QUANTITY_TOLERANCE_PCT` | `0.01` | Maximum allowed relative quantity difference before a pair becomes conflicting. |

Other environment variables:

- `MONGODB_URI` - MongoDB connection string
- `PORT` - HTTP port for the API
- `LOG_LEVEL` - Winston log level

## Key Design Decisions

### Why greedy one-to-one matching

The matching problem is bounded and run-scoped, so a greedy one-to-one pass is simpler, easier to reason about, and fast enough for hundreds of rows. It also avoids unstable results from many-to-many joins when one transaction would otherwise fan out across multiple candidates.

### Why flagged rows are persisted, not dropped

Flagged rows are part of the audit trail. Persisting them keeps the original CSV evidence, preserves the reason a row was flagged, and allows downstream reports to explain data quality problems rather than silently hiding them.

### How TRANSFER_IN ↔ TRANSFER_OUT symmetry is handled

Transfers are matched across perspective, not literal string equality. A user-side `TRANSFER_IN` can reconcile with an exchange-side `TRANSFER_OUT`, and vice versa, so the same transfer event can be represented correctly from opposite sides of the ledger.

### Why the reconcile endpoint is async and poll-based

Reconciliation can require ingestion, matching, and report writes, so the API returns `202 Accepted` immediately instead of blocking the request. The caller then polls the report endpoints until the run reaches `completed`, which keeps the API responsive and avoids request timeouts.

### Run partitioning strategy

Every persisted row is written with a `runId` partition key. That makes each reconciliation run isolated, supports repeatable reprocessing, and ensures rows from one run never contaminate another run's summary or reports.

## Testing Notes

The test suite includes unit tests for normalization and matching, plus API-level tests. The integration test in `tests/integration/reconcile.test.js` can use either a `MONGODB_URI` loaded from `.env.test` or an in-memory MongoDB server when available.

If you want to run the integration test against a local MongoDB instance, copy `.env.test.example` to `.env.test` and point `MONGODB_URI` at your test database.
