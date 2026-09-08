import { chromium } from 'playwright';
import { rpcHarness } from './rpc-harness.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const out = process.env.ARTIFACTS_DIR ?? join(tmpdir(), 'arkiv-chunking-browser');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
try {
const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const rpc = rpcHarness(), errors = [], checks = [];
let rejectSend = false, changeAfterSend = false;
page.on('pageerror', e => errors.push(e.message));
await page.exposeBinding('fixtureWallet', async (_, args) => {
  if (args.method === 'eth_sendTransaction' && rejectSend) throw { code: 4001, message: 'user rejected' };
  const result = await rpc.request(args);
  if (args.method === 'eth_sendTransaction' && changeAfterSend) {
    await page.evaluate(() => window.fixtureEmit('accountsChanged', ['0x' + '34'.repeat(20)]));
    changeAfterSend = false;
  }
  return result;
});
await page.addInitScript(() => {
  const listeners = new Map();
  window.ethereum = { request: args => window.fixtureWallet(args), on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); }, removeListener: (event, fn) => listeners.get(event)?.delete(fn) };
  window.fixtureEmit = (event, data) => { for (const listener of listeners.get(event) ?? []) listener(data); };
});
await page.route('https://chunking-fixture.invalid/**', async route => {
  const request = route.request().postDataJSON();
  const result = await rpc.request(request);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
});
async function upload(bytes, filename) {
  await page.locator('#file').setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes });
  await page.locator('#consent').check();
  await page.locator('#upload').click();
  await page.locator('#upload-status[data-state="success"]').waitFor({ timeout: 30000 });
  await page.locator('#retrieve').click();
  await page.locator('#download-status[data-state="success"]').waitFor({ timeout: 30000 });
  assert.match(await page.locator('#download-status').innerText(), /coinciden exactamente/);
  assert.equal(await page.locator('#download-hash').innerText(), '0x' + createHash('sha256').update(bytes).digest('hex'));
  const pending = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), filename);
  assert.deepEqual(await fs.readFile(await download.path()), bytes);
}
await page.goto(process.env.SAMPLE_URL ?? 'http://127.0.0.1:3076');
await page.locator('#rpc').fill('https://chunking-fixture.invalid');
const bytes = Buffer.from('Public synthetic fixture.\n'.repeat(11000));
await upload(bytes, 'synthetic-long-file-name-for-layout-and-integrity-verification.bin');
assert.equal(rpc.transactions.length, 5);
checks.push(`full ${bytes.length}-byte upload / SDK encoding / simulated receipt / query / byte comparison / actual downloaded attachment`);
for (const width of [390, 768, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${out}/sample-success-${width}.png`, fullPage: true });
}
const validKey = await page.locator('#manifest').inputValue();
rpc.entities[1].payload = '0x' + '00'.repeat(100000);
await page.locator('#retrieve').click();
await page.locator('#download-status[data-state="error"]').waitFor();
assert.match(await page.locator('#download-status').innerText(), /bytes diferentes/);
assert.equal(await page.locator('#save').isVisible(), false);
checks.push('same-length corruption rejects download and removes old attachment');
await page.screenshot({ path: `${out}/sample-corrupt-file.png`, fullPage: true });
await upload(Buffer.alloc(0), 'empty.bin'); checks.push('empty upload and downloaded empty attachment');
rejectSend = true;
await page.locator('#upload').click();
await page.locator('#upload-status[data-state="error"]').waitFor();
assert.match(await page.locator('#upload-status').innerText(), /falló|Rechazaste/);
checks.push('wallet rejects transaction, no success shown');
rejectSend = false; changeAfterSend = true;
const before = rpc.transactions.length;
await page.locator('#upload').click();
await page.locator('#upload-status[data-state="error"]').waitFor();
assert.equal(rpc.transactions.length, before + 1);
assert.match(await page.locator('#upload-summary').innerText(), /incompleto/);
checks.push('wallet account change after manifest aborts before next signed transaction');
assert.deepEqual(errors, []);
await fs.writeFile(`${out}/sample-flow-results.json`, JSON.stringify({ checks, browser: browser.version(), source: 'real package + real SDK with controlled in-memory RPC and injected wallet; no live chain writes', transactions: rpc.transactions, errors, firstManifestKey: validKey }, null, 2));
console.log(JSON.stringify({ ok: true, checks, transactions: rpc.transactions.length }));
} finally { await browser.close(); }
