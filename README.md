# Notification Handler — AWS Lambda (Node.js)

An AWS Lambda function that receives a batch of semi-structured events, **validates** and **normalizes** them, **deduplicates** redeliveries and stores each valid event as a row of the MySQL `Notification` table. Invalid events are logged with the reason, and the rest of the batch keeps going.

Storage runs against a **simulated MySQL** (`insertToMySQL(event)`) by default. The same code can also write to a **real MySQL** started with one `docker compose` command.

```bash
npm ci
node app/run.js --input sample/events.json --log-level INFO
```

---

## Contents

1. [Quick start](#quick-start)
2. [What happens to the sample events](#what-happens-to-the-sample-events)
3. [Event types and how to add one](#event-types-and-how-to-add-one)
4. [Validation and normalization rules](#validation-and-normalization-rules)
5. [Deduplication (idempotency)](#deduplication-idempotency)
6. [Storage: simulated and real MySQL](#storage-simulated-and-real-mysql)
7. [Lambda input and output](#lambda-input-and-output)
8. [Architecture](#architecture)
9. [Configuration](#configuration)
10. [Tests](#tests)
11. [Deploying to AWS](#deploying-to-aws)
12. [Design decisions and limitations](#design-decisions-and-limitations)

---

## Quick start

**Requirements:** Node.js 22+ (the Lambda runtime is `nodejs22.x`). Docker is needed only for the optional real-MySQL mode.

```bash
git clone https://github.com/AndriiDerkachUkraine/notification-handler-lambda.git
cd notification-handler-lambda
npm ci
node app/run.js --input sample/events.json --log-level INFO
```

The processing summary goes to **stdout**; logs go to **stderr** as JSON lines (CloudWatch-friendly), so the output can be piped into `jq` or a file.

```
--input, -i       JSON file: an array of events (or { "events": [...] })
--log-level, -l   DEBUG | INFO | WARN | ERROR (DEBUG also prints the SQL statements)
--store, -s       dummy | mysql (default: $NOTIFICATION_STORE or "dummy")
--output, -o      write the summary to a file instead of stdout
```

Sample inputs:
- [`sample/events.json`](sample/events.json): the events from the assignment.
- [`sample/events-edge-cases.json`](sample/events-edge-cases.json): Unix timestamps, weekday and day-first dates, more time zones, exact redeliveries with and without `event_id`, impossible dates, wrong field types, missing fields, non-object items.

---

## What happens to the sample events

| # | Event | Result | Why |
|---|---|---|---|
| 0 | Alice, `user_registered` | **stored** | roles `"admin, editor ,  manager"` → `["admin","editor","manager"]`; `joined` → `2021-04-01T00:00:00.000Z` |
| 1 | Bob, `user_registered` | **rejected** `invalid_fields` | `bob.smith(at)example.com` is not a valid email. It is **not** auto-corrected: validation must not guess |
| 2 | Carol, `password_reset` | **stored** | `2021/06/01 10:23+02:00` → `2021-06-01T08:23:00.000Z` |
| 3 | David, `user_deleted` | **stored** | `2021-07-15T00:00:00` (no zone) → treated as UTC |
| 4 | Eve, `unknown_type` | **rejected** `unsupported_event_type` | no handler is registered for this type |
| 5 | Alice, `event_id: dedupe-1`, `roles: null` | **stored** | `roles: null` → `[]` |
| 6 | Alice, `event_id: dedupe-1`, `roles: "admin"` | **duplicate** (`conflict: true`) | same `event_id` as #5: the first occurrence wins; the payload differs, so a warning is logged |

Actual summary (`results` trimmed to two entries):

```json
{
  "received": 7, "stored": 4, "duplicates": 1, "rejected": 2, "failed": 0,
  "results": [
    { "index": 0, "type": "user_registered", "eventId": null, "status": "stored", "notificationId": 1,
      "data": { "name": "Alice", "email": "alice@example.com", "roles": ["admin", "editor", "manager"], "joined": "2021-04-01T00:00:00.000Z" } },
    { "index": 1, "type": "user_registered", "status": "rejected", "error": "invalid_fields",
      "details": ["email: \"bob.smith(at)example.com\" is not a valid email address"] }
  ]
}
```

Each result has one of four statuses:

| Status | Meaning | Retried from SQS? |
|---|---|---|
| `stored` | a new `Notification` row was written | — |
| `duplicate` | already seen in this batch (`duplicateOf`) or stored earlier (`alreadyStored`) | no |
| `rejected` | `malformed_event`, `unsupported_event_type` or `invalid_fields`, with `details` listing **every** problem | no: a retry cannot fix bad data |
| `failed` | the database write failed (`storage_failed`, `retryable: true`) | **yes** |

---

## Event types and how to add one

Each event type is one small, declarative file: its name, its `NotificationTypeID` and a parser for every field it keeps.

```js
// app/domain/event-types/user-registered.js
export default defineEventType({
  type: 'user_registered',
  notificationTypeId: 1,
  fields: { name: requiredString, email, roles, joined: date },
});
```

Built in: `user_registered` (1), `password_reset` (2), `user_deleted` (3).

**Adding a type** (for example `user_invited`):

1. Create `app/domain/event-types/user-invited.js`:
   ```js
   import { date, email, optional, requiredString } from '../fields.js';
   import { defineEventType } from './define.js';

   export default defineEventType({
     type: 'user_invited',
     notificationTypeId: 4,
     fields: { email, invitedBy: requiredString, expires: optional(date) },
   });
   ```
2. Add it to `DEFAULT_TYPES` in `app/domain/event-types/index.js`.
3. Real-MySQL mode only: add `(4, 'user_invited')` to `NotificationType` in `db/schema.sql`.

Nothing else changes: validation, normalization, deduplication, storage, logging and the summary all work from the definition. A typo in a definition (bad name, ID outside `TINYINT`, duplicate type or ID) fails at startup, not on the first event. A test adds `user_invited` this way.

Field parsers live in [`app/domain/fields.js`](app/domain/fields.js) (`requiredString`, `email`, `date`, `roles`, `optional(...)`), so new types reuse the same rules. Fields not declared by a type are dropped (and listed at DEBUG level), so unexpected input never reaches the database.

---

## Validation and normalization rules

**`roles` → array of strings.** Accepts a comma-separated string, an array, a single string or `null`. Items are trimmed and lower-cased, empty items and duplicates are dropped, and order is kept.

| Input | Output |
|---|---|
| `"admin, editor ,  manager"` | `["admin","editor","manager"]` |
| `["viewer", " "]` | `["viewer"]` |
| `["Admin","admin"," Editor"]` | `["admin","editor"]` |
| `null` / missing | `[]` |
| `[1, 2]` | rejected |

**Email.** Uses the WHATWG HTML "valid email" rule plus RFC length limits (64/254), and rejects leading, trailing and double dots. The domain is lower-cased; the local part keeps its case (it may legally be case-sensitive). No MX lookup: that belongs to the sign-up flow, not to an event pipeline.

**Dates → ISO 8601 in UTC** (`2021-04-05T21:45:00.000Z`). The parser is strict and written for this task: `Date.parse` is engine-specific and silently turns `2021-02-30` into March 2.

| Accepted | Example |
|---|---|
| ISO / numeric date, optional time and zone | `2021-04-01`, `2021/06/01 10:23+02:00`, `2021-04-01T10:00:00.123Z`, `2021.4.1 8:05` |
| Month name, ordinal day, weekday, 12/24 h | `April 5th, 2021 13:45 PST`, `Monday, June 7, 2021 9:15 AM EDT`, `Sept 3, 2021` |
| Day first | `15th July 2021 18:30 CEST` |
| Unix timestamp (s or ms) | `1617235200`, `"1617235200000"` |

Rejected rather than guessed: relative dates (`yesterday`), impossible dates (`2021-02-30`, `April 31st`), `25:00`, `13:45 PM`, unknown zones, and ambiguous numeric forms such as `04/01/2021` (April 1 or January 4?). A value without a zone is treated as UTC. Zone abbreviations are limited to an explicit, unambiguous list (UTC/GMT, US zones, CET/CEST, EET/EEST).

---

## Deduplication (idempotency)

Queues deliver *at least once*, so the same event can arrive twice. The sample's two `dedupe-1` events test exactly this.

- **Key:** `event_id` when the producer sends one. Otherwise a SHA-256 of the normalized content, so an exact redelivery without an id is still caught.
- **Within a batch:** the first occurrence wins. A later event with the same key is reported as `duplicate`. If its payload differs, it is flagged `conflict: true` and logged as a warning, because two different payloads under one id is a producer bug worth seeing.
- **Across invocations:** the repository is idempotent too. In real MySQL, a `ProcessedEvent` table with the key as `PRIMARY KEY` is written **in the same transaction** as the notification. Even two concurrent deliveries create exactly one row (covered by an integration test). The simulated store keeps the same state in memory for the lifetime of the container.

Why "first wins" and not "last wins": a redelivery is the same event delivered again. Overwriting would let a stale replay change data after the fact. If updates are needed, they should be modeled as their own event type.

---

## Storage: simulated and real MySQL

Each valid event becomes a row of the given `Notification` table:

| Column | Value |
|---|---|
| `NotificationTypeID` | from the event type definition (see `NotificationType` in `db/schema.sql`) |
| `NotificationData` | JSON: `{ type, eventId, ...normalized fields }` |
| `CreatedByType` / `CreatedByID` | `0` / `0` = system (events carry no author; configurable) |
| `Status`, `Seen`, `IsBookmarked` | `0` (inbox, unseen, not bookmarked) |
| `Created` | column default: when the notification was created. The event's own dates stay in `NotificationData` |

**Simulated (default).** [`insertToMySQL(event)`](app/infrastructure/mysql/dummy.js) runs the **same parameterized SQL and parameters** as the real adapter, against in-memory tables. Run with `--log-level DEBUG` to see every statement:

```json
{"level":"DEBUG","msg":"SQL","sql":"INSERT INTO Notification (NotificationTypeID, NotificationData, ...) VALUES (?, ?, ?, ?, ?, ?, ?)",
 "params":[1,"{\"type\":\"user_registered\",\"eventId\":null,\"name\":\"Alice\",...}",0,0,0,0,0]}
```

**Real MySQL (optional).**

```bash
npm run db:up                                   # MySQL 8.4 on port 3307, schema from db/schema.sql
export MYSQL_URL=mysql://app:app@127.0.0.1:3307/notifications
node app/run.js --input sample/events.json --store mysql
node app/run.js --input sample/events.json --store mysql   # second run: stored events come back as "duplicate"
npm run db:down
```

On PowerShell, set the variable with `$env:MYSQL_URL="mysql://app:app@127.0.0.1:3307/notifications"`, or put it into `.env` (see `.env.example`).

---

## Lambda input and output

The handler (`app/handler.handler`) accepts three event shapes:

| Source | Input | Returns |
|---|---|---|
| Direct invocation / CLI | JSON array of events (or `{ "events": [...] }`) | the summary shown above |
| API Gateway / Function URL | the same JSON in `body` (base64 supported) | `200` with the summary; `400` for malformed JSON or payload |
| **SQS** | each message body is one event or an array of events | `{ "batchItemFailures": [...] }` |

With SQS and `ReportBatchItemFailures`, **only messages that failed to store are retried**. Invalid events are logged and dropped, because retrying cannot fix them. Exhausted retries go to the dead-letter queue (see `template.yaml`).

---

## Architecture

Ports & adapters: the domain knows nothing about Lambda or MySQL.

```
app/
├── run.js                        CLI: simulates a Lambda invocation
├── handler.js                    Lambda adapter: direct / HTTP / SQS events, wiring
├── config.js                     settings from env vars
├── domain/                       pure logic, no I/O
│   ├── dates.js                  strict date parser → ISO 8601
│   ├── fields.js                 reusable field parsers (email, date, roles, ...)
│   ├── event.js                  normalizeEvent, idempotency key, fingerprint
│   ├── notification.js           event → Notification row
│   ├── errors.js
│   └── event-types/              one file per type + registry
├── application/
│   ├── process-events.js         use case: normalize → dedupe → store → summary
│   └── ports.js                  NotificationRepository / Logger contracts
└── infrastructure/
    ├── mysql/statements.js       SQL shared by both stores
    ├── mysql/dummy.js            insertToMySQL(event): simulated MySQL
    ├── mysql/mysql-repository.js real MySQL (mysql2, transaction)
    ├── repositories.js           store factory (lazy imports)
    └── logger.js                 JSON-lines logger
db/schema.sql                     NotificationType + Notification (as given) + ProcessedEvent
```

Events in a batch are processed **sequentially, in input order**. That is what makes "first occurrence wins" deterministic, and for a few dozen inserts per invocation parallelism would add risk without a meaningful gain.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `NOTIFICATION_STORE` | `dummy` | `dummy` (simulated) \| `mysql` |
| `MYSQL_URL` | — | required for `mysql`, e.g. `mysql://app:app@127.0.0.1:3307/notifications` |
| `CREATED_BY_TYPE` / `CREATED_BY_ID` | `0` / `0` | author written to `Notification` for system events |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` \| `SILENT` |

---

## Tests

```bash
npm test                                         # 84 tests, no database needed
MYSQL_URL=mysql://app:app@127.0.0.1:3307/notifications npm test   # + 2 integration tests on real MySQL
```

Built-in `node:test` runner, no test dependencies:
- **dates:** every format above, plus the rejected cases;
- **fields:** email, roles, required/optional rules;
- **domain:** normalization, all rejection codes, idempotency keys, row mapping, and adding a new event type;
- **use case:** the assignment sample end to end (exact statuses), conflicting duplicates, an isolated storage failure, redelivery across invocations, duplicates without `event_id`;
- **handler:** direct, `{ events }`, HTTP (200/400), SQS partial batch failures, retry of a failed DB connection on the next invocation, and the CLI process itself;
- **MySQL integration** (when `MYSQL_URL` is set): insert-once and **concurrent** redelivery.

---

## Deploying to AWS

[`template.yaml`](template.yaml) (AWS SAM) wires the function to an SQS queue with a dead-letter queue and `ReportBatchItemFailures`. With the `MySqlUrl` parameter left empty, the function uses the simulated store. The template passes `cfn-lint`. It was not deployed to an AWS account as part of this task.

For production MySQL, put the credentials in Secrets Manager and connect through RDS Proxy, so Lambda scale-out does not exhaust database connections.

---

## Design decisions and limitations

- **Zone-less timestamps are UTC.** If producers send local times, the zone must be agreed per producer; guessing would silently shift data.
- **The weekday in "Monday, June 7, 2021" is accepted but not cross-checked** against the date.
- **Email validation is syntactic.** Whether an address exists is not this function's job.
- **`ProcessedEvent` is an addition** to the given schema. The `Notification` table has no unique column suitable for idempotency, and adding a separate table leaves the given one untouched.
- **The simulated store's deduplication lives in memory,** so it covers one warm container. Cross-container idempotency needs the real database (or e.g. a DynamoDB conditional write).
