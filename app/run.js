#!/usr/bin/env node
/** Local Lambda simulator: reads events from a JSON file and calls the real handler. */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const USAGE = `Usage: node app/run.js --input <events.json> [options]

Options:
  --input, -i       JSON file: an array of events (or { "events": [...] })
  --log-level, -l   DEBUG | INFO | WARN | ERROR (default: INFO; DEBUG also prints the SQL)
  --store, -s       dummy | mysql (default: $NOTIFICATION_STORE or "dummy")
  --output, -o      write the summary to a file instead of stdout
  --help, -h        show this help`;

async function main() {
  // Local convenience (.env is git-ignored); in Lambda these come from the function config.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const { values } = parseArgs({
    options: {
      input: { type: 'string', short: 'i' },
      'log-level': { type: 'string', short: 'l', default: process.env.LOG_LEVEL ?? 'INFO' },
      store: { type: 'string', short: 's' },
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help || !values.input) {
    console.error(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }

  // The handler reads env vars at import time, as in Lambda, so set them first.
  process.env.LOG_LEVEL = values['log-level'];
  if (values.store) process.env.NOTIFICATION_STORE = values.store;
  const { handler, shutdown } = await import('./handler.js');

  let events;
  try {
    events = JSON.parse(await readFile(values.input, 'utf8'));
  } catch (error) {
    console.error(`Cannot read input file "${values.input}": ${error.message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const summary = await handler(events, { awsRequestId: randomUUID() });
    const json = JSON.stringify(summary, null, 2);
    if (values.output) await writeFile(values.output, `${json}\n`);
    else process.stdout.write(`${json}\n`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await shutdown(); // an open MySQL pool would keep the CLI process alive
  }
}

main();
