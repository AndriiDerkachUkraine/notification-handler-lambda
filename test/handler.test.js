/** End-to-end through the handler (all event sources) and the CLI, with the simulated store. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { beforeEach, describe, it } from 'node:test';

process.env.LOG_LEVEL = 'SILENT';
const { createHandler, handler } = await import('../app/handler.js');
const { insertToMySQL, resetDummyDatabase } = await import('../app/infrastructure/mysql/dummy.js');

const valid = { type: 'user_deleted', email: 'david@example.com', deleted: '2021-07-15T00:00:00' };
const invalid = { type: 'user_deleted', email: 'nope', deleted: '2021-07-15' };

beforeEach(() => resetDummyDatabase());

describe('handler', () => {
  it('accepts a plain array (the assignment format) and { events }', async () => {
    assert.equal((await handler([valid])).stored, 1);
    assert.equal((await handler({ events: [{ ...valid, email: 'e@x.io' }] })).stored, 1);
  });

  it('answers API Gateway / Function URL requests over HTTP', async () => {
    const ok = await handler({ requestContext: { http: {} }, body: JSON.stringify([valid]) });
    assert.equal(ok.statusCode, 200);
    assert.equal(JSON.parse(ok.body).stored, 1);
    assert.equal((await handler({ requestContext: { http: {} }, body: '{oops' })).statusCode, 400);
    assert.equal((await handler({ requestContext: { http: {} }, body: '{"foo":1}' })).statusCode, 400);
  });

  it('throws on a payload that is not a list of events (direct invocation)', async () => {
    await assert.rejects(handler({ foo: 1 }), { name: 'RequestError' });
  });

  it('SQS: retries only messages whose storage failed, never invalid ones', async () => {
    const sqsHandler = createHandler({
      openRepository: async () => ({
        name: 'flaky',
        save: async (event) => {
          if (event.data.email === 'down@x.io') throw new Error('db down');
          return insertToMySQL(event);
        },
      }),
    });
    const record = (messageId, body) => ({ eventSource: 'aws:sqs', messageId, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const response = await sqsHandler({
      Records: [
        record('m1', valid),
        record('m2', invalid), // invalid data: logged, not retried
        record('m3', [{ ...valid, email: 'ok@x.io' }, { ...valid, email: 'down@x.io' }]), // one of two failed
        record('m4', 'not json'),
      ],
    });
    assert.deepEqual(response, { batchItemFailures: [{ itemIdentifier: 'm3' }] });
  });

  it('retries repository initialization on the next invocation after a failure', async () => {
    let attempts = 0;
    const h = createHandler({
      openRepository: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('db unreachable');
        return { name: 'ok', save: (e) => insertToMySQL(e) };
      },
    });
    await assert.rejects(h([valid]), /db unreachable/);
    assert.equal((await h([valid])).stored, 1);
  });
});

describe('CLI', () => {
  const cli = (...args) => spawnSync(process.execPath, ['app/run.js', ...args], { encoding: 'utf8', env: { ...process.env, NOTIFICATION_STORE: 'dummy' } });

  it('runs the documented command: summary on stdout, JSON logs on stderr', () => {
    const { status, stdout, stderr } = cli('--input', 'sample/events.json', '--log-level', 'INFO');
    assert.equal(status, 0);
    const summary = JSON.parse(stdout);
    assert.deepEqual([summary.stored, summary.duplicates, summary.rejected], [4, 1, 2]);
    assert.ok(stderr.trim().split('\n').every((line) => JSON.parse(line).level));
  });

  it('prints the SQL at DEBUG level', () => {
    assert.match(cli('-i', 'sample/events.json', '-l', 'DEBUG').stderr, /INSERT INTO Notification/);
  });

  it('fails clearly on a missing input file and shows usage without --input', () => {
    assert.equal(cli('-i', 'nope.json').status, 1);
    const usage = cli();
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /Usage:/);
  });
});
