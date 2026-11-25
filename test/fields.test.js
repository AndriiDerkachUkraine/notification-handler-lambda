import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { date, email, optional, requiredString, roles } from '../app/domain/fields.js';

describe('email', () => {
  for (const value of ['alice@example.com', 'first.last+tag@sub.example.co.uk', "o'neil@example.org", 'x@a-b.io']) {
    it(`accepts ${value}`, () => assert.equal(email(value).ok, true));
  }
  for (const value of ['bob.smith(at)example.com', 'no-at-sign', 'a@b', 'a@@b.com', '.a@b.com', 'a.@b.com', 'a..b@c.com',
    'a b@c.com', 'a@-b.com', `${'x'.repeat(65)}@b.com`, 42]) {
    it(`rejects ${JSON.stringify(value)}`, () => assert.equal(email(value).ok, false));
  }
  it('lower-cases the domain only and trims', () => assert.deepEqual(email(' Frank@Example.COM '), { ok: true, value: 'Frank@example.com' }));
  it('reports a missing value as required', () => assert.deepEqual(email(undefined), { ok: false, reason: 'is required' }));
});

describe('roles', () => {
  const cases = [
    ['admin, editor ,  manager', ['admin', 'editor', 'manager']],
    [['viewer', ' '], ['viewer']],
    ['admin', ['admin']],
    [null, []],
    [undefined, []],
    ['', []],
    [['Admin', 'admin', ' Editor'], ['admin', 'editor']],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => assert.deepEqual(roles(input), { ok: true, value: expected }));
  }
  for (const input of [[1, 2], { admin: true }, 7]) {
    it(`rejects ${JSON.stringify(input)}`, () => assert.equal(roles(input).ok, false));
  }
});

describe('other parsers', () => {
  it('requiredString trims and requires content', () => {
    assert.deepEqual(requiredString('  Alice '), { ok: true, value: 'Alice' });
    assert.deepEqual(requiredString('   '), { ok: false, reason: 'is required' });
    assert.equal(requiredString(5).ok, false);
  });

  it('date wraps the parser with clear reasons', () => {
    assert.deepEqual(date('2021-04-01'), { ok: true, value: '2021-04-01T00:00:00.000Z' });
    assert.match(date('yesterday').reason, /not a recognizable date/);
    assert.deepEqual(date(null), { ok: false, reason: 'is required' });
  });

  it('optional allows absence but still validates presence', () => {
    const maybeDate = optional(date);
    assert.deepEqual(maybeDate(undefined), { ok: true, value: undefined });
    assert.equal(maybeDate('nope').ok, false);
  });
});
