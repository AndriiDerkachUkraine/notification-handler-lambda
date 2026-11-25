import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fingerprint, idempotencyKey, normalizeEvent } from '../app/domain/event.js';
import { defineEventType } from '../app/domain/event-types/define.js';
import { createRegistry, defaultRegistry } from '../app/domain/event-types/index.js';
import { date, email, optional, requiredString } from '../app/domain/fields.js';
import { toNotificationRow } from '../app/domain/notification.js';

describe('normalizeEvent', () => {
  it('normalizes a user_registered event and drops unknown fields', () => {
    const result = normalizeEvent(
      { type: 'user_registered', name: 'Alice', email: 'alice@example.com', roles: 'admin, editor ,  manager', joined: '2021-04-01', plan: 'pro' },
      defaultRegistry,
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.event.data, {
      name: 'Alice',
      email: 'alice@example.com',
      roles: ['admin', 'editor', 'manager'],
      joined: '2021-04-01T00:00:00.000Z',
    });
    assert.equal(result.event.eventId, null);
    assert.deepEqual(result.ignoredFields, ['plan']);
  });

  it('reports every invalid field at once', () => {
    const result = normalizeEvent({ type: 'user_registered', email: 'bad', roles: 'x', joined: 'never' }, defaultRegistry);
    assert.equal(result.code, 'invalid_fields');
    assert.deepEqual(result.details.map((d) => d.split(':')[0]), ['name', 'email', 'joined']);
  });

  it('distinguishes malformed, unsupported and invalid-id events', () => {
    assert.equal(normalizeEvent('text', defaultRegistry).code, 'malformed_event');
    assert.equal(normalizeEvent({ email: 'a@b.co' }, defaultRegistry).code, 'malformed_event');
    assert.equal(normalizeEvent({ type: 'unknown_type' }, defaultRegistry).code, 'unsupported_event_type');
    const badId = normalizeEvent({ type: 'user_deleted', email: 'a@b.co', deleted: '2021-01-01', event_id: true }, defaultRegistry);
    assert.deepEqual(badId.details, ['event_id: must be a non-empty string or a number']);
  });

  it('accepts numeric event ids as strings and trims the type', () => {
    const result = normalizeEvent({ type: ' user_deleted ', email: 'a@b.co', deleted: '2021-01-01', event_id: 42 }, defaultRegistry);
    assert.equal(result.event.type, 'user_deleted');
    assert.equal(result.event.eventId, '42');
  });
});

describe('idempotency', () => {
  const event = (data, eventId = null) => ({ type: 'user_deleted', eventId, data, definition: {} });

  it('uses event_id when present, otherwise a content hash', () => {
    assert.equal(idempotencyKey(event({ email: 'a@b.co' }, 'dedupe-1')), 'id:dedupe-1');
    assert.match(idempotencyKey(event({ email: 'a@b.co' })), /^sha256:[0-9a-f]{64}$/);
  });

  it('fingerprints content, not ids', () => {
    assert.equal(fingerprint(event({ email: 'a@b.co' }, '1')), fingerprint(event({ email: 'a@b.co' }, '2')));
    assert.notEqual(fingerprint(event({ email: 'a@b.co' })), fingerprint(event({ email: 'c@d.co' })));
  });
});

describe('event types are extensible', () => {
  const userInvited = defineEventType({
    type: 'user_invited',
    notificationTypeId: 4,
    fields: { email, invitedBy: requiredString, expires: optional(date) },
  });

  it('a new type plugs in with one definition', () => {
    const registry = createRegistry([...defaultRegistry.all(), userInvited]);
    const result = normalizeEvent({ type: 'user_invited', email: 'z@x.io', invitedBy: 'Alice' }, registry);
    assert.equal(result.ok, true);
    assert.deepEqual(result.event.data, { email: 'z@x.io', invitedBy: 'Alice' });
  });

  it('bad definitions fail at startup', () => {
    assert.throws(() => defineEventType({ type: 'Bad Name', notificationTypeId: 5, fields: { email } }), /invalid event type name/);
    assert.throws(() => defineEventType({ type: 'x', notificationTypeId: 300, fields: { email } }), /TINYINT/);
    assert.throws(() => defineEventType({ type: 'x', notificationTypeId: 5, fields: {} }), /fields/);
    assert.throws(() => createRegistry([userInvited, userInvited]), /duplicate event type/);
  });
});

describe('toNotificationRow', () => {
  it('maps a normalized event onto the Notification table', () => {
    const { event } = normalizeEvent({ type: 'password_reset', email: 'carol@example.com', requested: '2021/06/01 10:23+02:00', event_id: 'r-1' }, defaultRegistry);
    assert.deepEqual(toNotificationRow(event, { createdByType: 0, createdById: 0 }), {
      NotificationTypeID: 2,
      NotificationData: { type: 'password_reset', eventId: 'r-1', email: 'carol@example.com', requested: '2021-06-01T08:23:00.000Z' },
      CreatedByType: 0,
      CreatedByID: 0,
      Status: 0,
      Seen: 0,
      IsBookmarked: 0,
    });
  });
});
