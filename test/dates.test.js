import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toIsoDate } from '../app/domain/dates.js';

describe('toIsoDate', () => {
  const valid = [
    // From the assignment
    ['2021-04-01', '2021-04-01T00:00:00.000Z'],
    ['April 5th, 2021 13:45 PST', '2021-04-05T21:45:00.000Z'],
    ['2021/06/01 10:23+02:00', '2021-06-01T08:23:00.000Z'],
    ['2021-07-15T00:00:00', '2021-07-15T00:00:00.000Z'],
    // Other common shapes
    ['2021-04-01T10:00:00.123456Z', '2021-04-01T10:00:00.123Z'],
    ['2021-04-01T10:00+0530', '2021-04-01T04:30:00.000Z'],
    ['2021.4.1 8:05', '2021-04-01T08:05:00.000Z'],
    ['Monday, June 7, 2021 9:15 AM EDT', '2021-06-07T13:15:00.000Z'],
    ['Mon, June 7, 2021', '2021-06-07T00:00:00.000Z'],
    // The weekday matches the local date, even though in UTC it is already Tuesday
    ['Monday, June 7, 2021 11:30 PM PDT', '2021-06-08T06:30:00.000Z'],
    ['Apr 5 2021 12:00 am', '2021-04-05T00:00:00.000Z'],
    ['Sept 3, 2021', '2021-09-03T00:00:00.000Z'],
    ['15th July 2021 18:30 CEST', '2021-07-15T16:30:00.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
    [1617235200, '2021-04-01T00:00:00.000Z'],
    ['1617235200000', '2021-04-01T00:00:00.000Z'],
  ];
  for (const [input, expected] of valid) {
    it(`${JSON.stringify(input)} → ${expected}`, () => assert.equal(toIsoDate(input), expected));
  }

  const invalid = ['yesterday', '2021-02-30', '2023-02-29', 'April 31st, 2021', '2021-04-01 25:00', '2021-04-01 13:45 PM',
    '2021-04-01 10:00 XYZ', 'Smarch 5, 2021', '04/01/2021', 'Tuesday, June 7, 2021', 'Foo, June 7, 2021', '', '   ', null, undefined, {}, -5, NaN];
  for (const input of invalid) {
    it(`rejects ${JSON.stringify(input) ?? String(input)}`, () => assert.equal(toIsoDate(input), null));
  }
});
