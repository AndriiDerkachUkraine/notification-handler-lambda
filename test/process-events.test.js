import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, it } from 'node:test';

import { processEvents } from '../app/application/process-events.js';
import { defaultRegistry } from '../app/domain/event-types/index.js';
import { createDummyRepository, dummyRows, insertToMySQL, resetDummyDatabase } from '../app/infrastructure/mysql/dummy.js';
import { createLogger } from '../app/infrastructure/logger.js';

const lines = [];
const logger = createLogger({ level: 'DEBUG', sink: (line) => lines.push(JSON.parse(line)) });
const creator = { createdByType: 0, createdById: 0 };
const sample = JSON.parse(await readFile(new URL('../sample/events.json', import.meta.url), 'utf8'));

const run = (events, repository = createDummyRepository({ creator })) => processEvents({ events, registry: defaultRegistry, repository, logger });

beforeEach(() => {
  resetDummyDatabase();
  lines.length = 0;
});

describe('processEvents on the assignment sample', () => {
  it('stores, rejects and deduplicates exactly as documented', async () => {
    const summary = await run(sample);
    assert.deepEqual(
      summary.results.map((r) => [r.status, r.error ?? null]),
      [
        ['stored', null],
        ['rejected', 'invalid_fields'], // bob.smith(at)example.com
        ['stored', null],
        ['stored', null],
        ['rejected', 'unsupported_event_type'],
        ['stored', null], // first "dedupe-1" wins
        ['duplicate', null],
      ],
    );
    assert.deepEqual({ ...summary, results: undefined }, { received: 7, stored: 4, duplicates: 1, rejected: 2, failed: 0, results: undefined });
  });

  it('normalizes roles and dates in the stored rows', async () => {
    await run(sample);
    const data = dummyRows().map((r) => r.NotificationData);
    assert.deepEqual(data[0].roles, ['admin', 'editor', 'manager']);
    assert.equal(data[1].requested, '2021-06-01T08:23:00.000Z');
    assert.equal(data[2].deleted, '2021-07-15T00:00:00.000Z');
    assert.deepEqual(data[3].roles, []); // roles: null
  });

  it('flags a conflicting duplicate and logs every rejection with its reason', async () => {
    const summary = await run(sample);
    assert.deepEqual(summary.results[6], { index: 6, type: 'user_registered', eventId: 'dedupe-1', status: 'duplicate', duplicateOf: 5, conflict: true });
    const rejected = lines.filter((l) => l.msg === 'event rejected');
    assert.equal(rejected.length, 2);
    assert.match(rejected[0].details[0], /not a valid email/);
  });
});

describe('processEvents resilience', () => {
  const event = (email, id) => ({ type: 'user_deleted', email, deleted: '2021-07-15', event_id: id });

  it('a storage failure affects only that event, which stays retryable', async () => {
    const flaky = {
      name: 'flaky',
      save: async (e) => {
        if (e.data.email === 'b@x.io') throw new Error('connection lost');
        return insertToMySQL(e);
      },
    };
    const summary = await run([event('a@x.io', '1'), event('b@x.io', '2'), event('c@x.io', '3')], flaky);
    assert.deepEqual(summary.results.map((r) => r.status), ['stored', 'failed', 'stored']);
    assert.equal(summary.results[1].retryable, true);
  });

  it('treats events already stored by an earlier invocation as duplicates', async () => {
    await run([event('a@x.io', 'once')]);
    const second = await run([event('a@x.io', 'once')]);
    assert.deepEqual(second.results[0].status, 'duplicate');
    assert.equal(second.results[0].alreadyStored, true);
    assert.equal(dummyRows().length, 1);
  });

  it('deduplicates exact redeliveries that have no event_id', async () => {
    const noId = { type: 'password_reset', email: 'g@x.io', requested: '2021-06-07' };
    const summary = await run([noId, { ...noId }]);
    assert.deepEqual(summary.results.map((r) => [r.status, r.conflict]), [['stored', undefined], ['duplicate', false]]);
  });

  it('handles an empty batch', async () => {
    assert.deepEqual((await run([])).received, 0);
  });
});
