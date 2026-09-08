import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the actual sample helper without changing the package build or shipping sample code.
const source = await readFile(new URL('../sample/src/expiration.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { dateToBlocks, estimateExpirationDate, toLocalDateTimeInput, ExpirationInputError, MAX_TIMING_AGE_MS } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const now = Date.parse('2026-09-08T22:00:00Z');
const timing = { currentBlock: 198000n, currentBlockTime: now / 1000, blockDuration: 2 };
const future = seconds => new Date(now + seconds * 1000);

test('date adapter uses live network cadence and rounds up without assuming two-second blocks', () => {
  assert.equal(dateToBlocks(future(65), timing, 2, now), 33);
  assert.equal(dateToBlocks(future(661), { ...timing, blockDuration: 20 }, 2, now), 34);
  assert.equal(dateToBlocks(future(64), timing, 2, now), 32);
});

test('date adapter enforces chunk-dependent minimum and maximum without clamping', () => {
  assert.throws(() => dateToBlocks(future(64), timing, 40, now), ExpirationInputError);
  assert.equal(dateToBlocks(future(86), timing, 40, now), 43);
  assert.equal(dateToBlocks(future(15_768_000 * 2), timing, 2, now), 15_768_000);
  assert.throws(() => dateToBlocks(future(15_768_000 * 2 + 1), timing, 2, now), /earlier/);
  for (const count of [0, -1, 1.5, NaN, 4097]) {
    assert.throws(() => dateToBlocks(future(3600), timing, count, now), /chunks/);
  }
});

test('invalid and elapsed dates fail before a write budget is returned', () => {
  for (const value of [new Date(NaN), '2026-09-09', null]) {
    assert.throws(() => dateToBlocks(value, timing, 2, now), /valid expiration/);
  }
  for (const value of [new Date(now), new Date(now - 1)]) {
    assert.throws(() => dateToBlocks(value, timing, 2, now), /future/);
  }
});

test('both conversions reject malformed timing and clocks beyond the five-minute tolerance', () => {
  assert.equal(MAX_TIMING_AGE_MS, 300_000);
  for (const invalid of [
    null, { ...timing, currentBlock: 1 }, { ...timing, currentBlock: -1n },
    { ...timing, currentBlock: 1n << 64n }, { ...timing, currentBlockTime: NaN },
    { ...timing, currentBlockTime: now / 1000 + 0.5 },
    ...[0, -1, NaN, Infinity].map(blockDuration => ({ ...timing, blockDuration })),
    { ...timing, currentBlockTime: now / 1000 - 301 },
    { ...timing, currentBlockTime: now / 1000 + 301 },
  ]) {
    assert.throws(() => dateToBlocks(future(3600), invalid, 2, now), ExpirationInputError);
    assert.throws(() => estimateExpirationDate(200000n, invalid, now), ExpirationInputError);
  }
  assert.equal(dateToBlocks(future(3600), { ...timing, currentBlockTime: now / 1000 - 300 }, 2, now), 1950);
  assert.throws(() => dateToBlocks(future(3600), timing, 2, NaN), /device date/);
});

test('date estimate reflects actual expiration and retains exact bigint differences', () => {
  assert.equal(estimateExpirationDate(198100n, timing, now).getTime(), now + 200000);
  assert.equal(estimateExpirationDate(197900n, timing, now).getTime(), now - 200000);
  const highBlock = 9_007_199_254_740_992n;
  assert.equal(estimateExpirationDate(highBlock + 1n, { ...timing, currentBlock: highBlock }, now).getTime(), now + 2000);
  assert.equal(dateToBlocks(future(64), { ...timing, currentBlock: highBlock }, 2, now), 32);
});

test('uint64 overflow, unsafe differences and unrepresentable dates fail explicitly', () => {
  assert.throws(() => dateToBlocks(future(64), { ...timing, currentBlock: (1n << 64n) - 10n }, 2, now), /earlier/);
  assert.throws(() => dateToBlocks(future(64), { ...timing, blockDuration: Number.MIN_VALUE }, 2, now), /earlier/);
  for (const expiresAt of [-1n, 1n << 64n, 198100]) {
    assert.throws(() => estimateExpirationDate(expiresAt, timing, now), /cannot be displayed/);
  }
  assert.throws(() => estimateExpirationDate(1n << 63n, timing, now), /date range/);
  assert.throws(() => estimateExpirationDate(198100n, { ...timing, blockDuration: Number.MAX_VALUE }, now), /date range/);
});

test('datetime-local formatting preserves local calendar fields', () => {
  const local = new Date(2026, 8, 9, 14, 7, 42);
  assert.equal(toLocalDateTimeInput(local), '2026-09-09T14:07');
  assert.throws(() => toLocalDateTimeInput(new Date(NaN)), ExpirationInputError);
});
