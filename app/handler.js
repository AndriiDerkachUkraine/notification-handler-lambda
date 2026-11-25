/**
 * Lambda entry point: direct invocation (array or `{ events }`) → summary; API Gateway /
 * Function URL → HTTP response; SQS → `batchItemFailures` (only storage failures are
 * retried: a retry cannot fix invalid data).
 */
import { processEvents, Status } from './application/process-events.js';
import { loadConfig } from './config.js';
import { defaultRegistry } from './domain/event-types/index.js';
import { RequestError } from './domain/errors.js';
import { createLogger } from './infrastructure/logger.js';
import { createRepository } from './infrastructure/repositories.js';

const isSqs = (event) => Array.isArray(event?.Records) && event.Records.length > 0 && event.Records.every((r) => r.eventSource === 'aws:sqs');
const isHttp = (event) => typeof event?.body === 'string' || event?.requestContext?.http !== undefined;

const httpResponse = (statusCode, payload) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

function eventsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.events)) return payload.events;
  throw new RequestError('expected a JSON array of events or { "events": [...] }');
}

/** One SQS message may carry one event or an array; each event remembers its message id. */
function eventsFromSqs(records) {
  const events = [];
  const messageIds = [];
  for (const record of records) {
    let body;
    try {
      body = JSON.parse(record.body);
    } catch {
      body = record.body; // rejected later as malformed_event, with the reason logged
    }
    for (const event of Array.isArray(body) ? body : [body]) {
      events.push(event);
      messageIds.push(record.messageId);
    }
  }
  return { events, messageIds };
}

function parseHttpBody(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString('utf8') : event.body;
    return JSON.parse(raw || 'null');
  } catch {
    throw new RequestError('request body is not valid JSON');
  }
}

/** Dependencies are injectable for tests; the exported `handler` uses the real ones. */
export function createHandler({ config = loadConfig(), registry = defaultRegistry, openRepository = () => createRepository(config) } = {}) {
  let repositoryPromise; // reused by warm invocations (keeps the DB pool open)

  const repository = () =>
    (repositoryPromise ??= openRepository().catch((error) => {
      repositoryPromise = undefined; // let the next invocation retry
      throw error;
    }));

  async function handle(event, context = {}) {
    const logger = createLogger({ level: process.env.LOG_LEVEL, context: { requestId: context.awsRequestId } });
    const http = isHttp(event);
    const sqs = !http && isSqs(event);

    try {
      const { events, messageIds } = sqs ? eventsFromSqs(event.Records) : { events: eventsFrom(http ? parseHttpBody(event) : event) };
      logger.info('batch received', { events: events.length, source: sqs ? 'sqs' : http ? 'http' : 'direct', store: config.store });

      const summary = await processEvents({ events, registry, repository: await repository(), logger });
      const { results, ...totals } = summary;
      logger.info('batch processed', totals);

      if (sqs) {
        const failed = new Set(results.filter((r) => r.status === Status.FAILED).map((r) => messageIds[r.index]));
        return { batchItemFailures: [...failed].map((itemIdentifier) => ({ itemIdentifier })) };
      }
      return http ? httpResponse(200, summary) : summary;
    } catch (error) {
      const isRequestError = error instanceof RequestError;
      if (isRequestError) logger.error('request rejected', { error: error.message });
      else logger.error('unexpected failure', { error: error.message, stack: error.stack });
      if (http) return isRequestError ? httpResponse(400, { error: error.code, message: error.message }) : httpResponse(500, { error: 'internal_error' });
      throw error; // direct / SQS: Lambda reports it (SQS then retries the whole batch)
    }
  }

  /** Closes the store's connections. Lambda never needs it (it freezes the container); the CLI does. */
  handle.shutdown = async () => {
    const opened = await repositoryPromise?.catch(() => undefined);
    repositoryPromise = undefined;
    await opened?.close?.();
  };

  return handle;
}

export const handler = createHandler();
export const shutdown = () => handler.shutdown();
