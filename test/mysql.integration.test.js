/**
 * Runs against a real MySQL only when MYSQL_URL is set (npm run db:up, see README);
 * skipped otherwise, so `npm test` needs no database.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';

import { normalizeEvent } from '../app/domain/event.js';
import { defaultRegistry } from '../app/domain/event-types/index.js';
import { createMysqlRepository } from '../app/infrastructure/mysql/mysql-repository.js';

const url = process.env.MYSQL_URL;

const skip = !url && 'MYSQL_URL is not set (see README → Real MySQL)';

describe('MySQL repository', () => {
  const creator = { createdByType: 0, createdById: 0 };
  let repository;
  const repo = async () => (repository ??= await createMysqlRepository({ url, creator }));
  after(() => repository?.close());

  const event = () =>
    normalizeEvent({ type: 'user_registered', name: 'Test', email: 't@x.io', roles: 'a, b', joined: '2021-04-01', event_id: randomUUID() }, defaultRegistry).event;

  it('inserts once and reports the redelivery as a duplicate', { skip }, async () => {
    const e = event();
    const first = await (await repo()).save(e);
    assert.ok(first.notificationId > 0);
    assert.deepEqual(await (await repo()).save(e), { duplicate: true });
  });

  it('stays idempotent under concurrent deliveries of the same event', { skip }, async () => {
    const e = event();
    const outcomes = await Promise.all([(await repo()).save(e), (await repo()).save(e)]);
    assert.equal(outcomes.filter((o) => o.notificationId).length, 1);
    assert.equal(outcomes.filter((o) => o.duplicate).length, 1);
  });
});
