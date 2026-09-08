import { chromium } from 'playwright';
import { rpcHarness } from './rpc-harness.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPublicClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { key, str } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import { custom } from 'viem';

const out = process.env.ARTIFACTS_DIR ?? join(tmpdir(), 'arkiv-chunking-browser');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const checks = [], errors = [], geometry = [];
let page;
try {
  // Isolated Chromium: no connection to the developer's browser or real wallet.
  const context = await browser.newContext({ colorScheme: 'dark', locale: 'en-US', viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page = await context.newPage();
  const rpc = rpcHarness();
  let rejectSend = false, changeAfterSend = false, walletChain = '0x7614d1', readFailure = false;
  let staleTiming = false, failAfterFinalize = false, inspectionFailure = false, heldSend;
  let releaseSend;
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeBinding('fixtureWallet', async (_, args) => {
    if (args.method === 'eth_chainId') return walletChain;
    if (args.method === 'wallet_switchEthereumChain') return null; // A declined/unapplied switch must be caught by the app's recheck.
    if (args.method === 'eth_sendTransaction') {
      if (rejectSend) throw { code: 4001, message: 'user rejected' };
      if (heldSend) await heldSend;
    }
    const result = await rpc.request(args);
    if (args.method === 'eth_sendTransaction') {
      if (changeAfterSend) {
        await page.evaluate(() => window.fixtureEmit('accountsChanged', ['0x' + '34'.repeat(20)]));
        changeAfterSend = false;
      }
      if (failAfterFinalize && rpc.entities.at(-1) && rpc.entities.some(entity => entity.attributes.some(a => a.name === 'complete' && a.value === true))) {
        // Arm against the just-written manifest only, never against a previous completed upload.
        const latestManifest = rpc.entities.findLast(entity => entity.attributes.some(a => a.name === 'type' && a.value === 'arkiv-chunking/manifest/v1'));
        if (latestManifest?.attributes.some(a => a.name === 'complete' && a.value === true)) readFailure = true;
      }
    }
    return result;
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    window.ethereum = {
      request: args => window.fixtureWallet(args),
      on: (event, fn) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
      removeListener: (event, fn) => listeners.get(event)?.delete(fn),
    };
    window.fixtureEmit = (event, data) => { for (const listener of listeners.get(event) ?? []) listener(data); };
  });
  // The application uses its real fixed RPC URL; intercept transport only, preserving SDK encoding/query parsing.
  await page.route('https://rpc.tiramisu.db-chain.testnet.arkiv.network/**', async route => {
    const request = route.request().postDataJSON();
    try {
      if (request.method === 'arkiv_query' && readFailure) throw Error('Controlled post-confirmation read failure');
      if (request.method === 'arkiv_query' && inspectionFailure && await page.locator('#workflow-status').getAttribute('data-state') === 'success') throw Error('Controlled inspection-only failure');
      const result = await rpc.request(request);
      if (request.method === 'arkiv_getBlockTiming' && staleTiming) result.current_block_time -= 301;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    } catch {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'Controlled RPC failure' } }) });
    }
  });
  async function idle() { await page.locator('#workspace[aria-busy="false"]').waitFor({ timeout: 30000 }); }
  async function state(value) { await page.locator(`#workflow-status[data-state="${value}"]`).waitFor({ timeout: 30000 }); await idle(); }
  async function reset() { await page.goto(process.env.SAMPLE_URL ?? 'http://127.0.0.1:3076'); await page.locator('#selected-meta').filter({ hasText: '120,001 bytes' }).waitFor(); }
  async function capture(stateName) {
    await page.evaluate(() => document.fonts.ready);
    for (const theme of ['dark', 'light']) {
      // Switch through the real control; it remains available while file operations run.
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme').click();
    for (const width of [390, 699, 701, 768, 959, 961, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const probe = await page.evaluate(() => ({
        width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
        theme: document.documentElement.dataset.theme, background: getComputedStyle(document.body).backgroundColor,
        columns: getComputedStyle(document.getElementById('workspace')).gridTemplateColumns,
        primary: ['connect', 'choose', 'expiration', 'upload'].map(id => {
          const node = document.getElementById(id), r = node.getBoundingClientRect();
          return { id, top: r.top, bottom: r.bottom, left: r.left, right: r.right, font: getComputedStyle(node).fontFamily };
        }),
      }));
      assert.ok(probe.documentWidth <= width, `Horizontal overflow at ${width}px in ${stateName}`);
      if (width === 1440) {
        await page.evaluate(() => scrollTo(0, 0));
        for (const id of ['connect', 'choose', 'expiration', 'upload']) {
          const control = await page.locator(`#${id}`).boundingBox();
          assert.ok(control.y >= 0 && control.y + control.height <= 900, `${id} must be visible without desktop scrolling`);
        }
      }
      geometry.push({ state: stateName, ...probe });
      await page.screenshot({ path: join(out, `sample-${stateName}-${theme}-${width}.png`), fullPage: true });
    }
    }
    if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.locator('#theme').click();
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  async function assertDownload(bytes, filename) {
    assert.equal(await page.locator('#result-title').innerText(), 'File verified');
    assert.match(await page.locator('#workflow-status').innerText(), /Every byte matches|integrity verified/);
    const pending = page.waitForEvent('download');
    await page.locator('#save').click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), filename);
    const saved = await fs.readFile(await download.path());
    assert.deepEqual(saved, bytes);
    assert.equal(createHash('sha256').update(saved).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
    const manifestKey = await page.locator('#manifest').inputValue();
    assert.equal(await page.locator('#explorer').getAttribute('href'), `https://indexer.tiramisu.db-chain.testnet.arkiv.network/entity/${manifestKey}`);
    return manifestKey;
  }
  async function assertChunks(bytes) {
    const manifestKey = await page.locator('#manifest').inputValue();
    const snippet = await page.locator('#query-code').textContent();
    assert.ok(snippet.includes(`eq('manifest', key('${manifestKey}'))`));
    assert.ok(snippet.includes('payload: true') && snippet.includes('attributes: true') && snippet.includes('key: true'));
    assert.ok(!snippet.includes('import ') && !snippet.includes('downloadFile') && !snippet.includes('createPublicClient'));
    // Execute exactly the displayed query with the real SDK and the same fixture data.
    const client = createPublicClient({ chain: tiramisu, transport: custom({ request: args => rpc.request(args) }) });
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const entities = await new AsyncFunction('client', 'key', 'str', 'eq', `${snippet}\nreturn chunks;`)(client, key, str, eq);
    entities.sort((a, b) => Number(a.attributes.seq.value - b.attributes.seq.value));
    const expectedCount = Math.max(1, Math.ceil(bytes.length / 100000));
    assert.equal(entities.length, expectedCount);
    const cards = page.locator('#chunk-list article.chunk-card');
    assert.equal(await cards.count(), expectedCount);
    const recovered = [];
    for (let index = 0; index < entities.length; index++) {
      const entity = entities[index], card = cards.nth(index);
      const expected = bytes.subarray(index * 100000, (index + 1) * 100000);
      assert.deepEqual(Buffer.from(entity.payload), expected);
      assert.equal(await card.getAttribute('data-seq'), String(index));
      assert.equal(await card.locator('.chunk-key').textContent(), entity.key);
      assert.equal(await card.locator('.chunk-key').getAttribute('href'), `https://indexer.tiramisu.db-chain.testnet.arkiv.network/entity/${entity.key}`);
      assert.equal(entity.attributes.manifest.value, manifestKey);
      const payloadDownload = page.waitForEvent('download');
      await card.locator('.chunk-download').click();
      const payload = await fs.readFile(await (await payloadDownload).path());
      assert.deepEqual(payload, expected);
      recovered.push(payload);
      assert.equal(await card.locator('.payload-preview').textContent(), expected.length ? expected.subarray(0, 96).toString('utf8') : '(empty payload)');
      const attributes = JSON.parse(await card.locator('details pre').textContent());
      assert.equal(attributes.manifest.value, manifestKey);
      assert.equal(attributes.seq.value, String(index));
    }
    assert.deepEqual(Buffer.concat(recovered), bytes);
    assert.ok(await page.locator('#reassembly').isVisible());
    assert.ok((await page.locator('#reassembly').textContent()).includes(bytes.length.toLocaleString('en-US')));
    assert.equal(await page.locator('#result-key, #result-hash').count(), 0);
  }
  async function upload(bytes, filename) {
    await page.locator('#file').setInputFiles({ name: filename, mimeType: 'application/octet-stream', buffer: bytes });
    await page.locator('#upload').click();
    await state('success');
    const manifestKey = await assertDownload(bytes, filename);
    await assertChunks(bytes);
    return manifestKey;
  }

  await reset();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#theme').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await reset();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('#theme').click();
  await reset();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  checks.push('dark default; real theme toggle supports light and preserves selected theme across reload');
  assert.equal(await page.locator('[data-step]').count(), 0);
  await page.locator('details.approvals summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details.approvals').getAttribute('open'), '');
  assert.match(await page.locator('details.approvals').innerText(), /4 wallet approvals/);
  assert.match(await page.locator('details.approvals').innerText(), /manifest/i);
  assert.match(await page.locator('#chunk-approvals').innerText(), /2/);
  assert.match(await page.locator('details.approvals').innerText(), /complete/i);
  assert.match(await page.locator('details.approvals').innerText(), /no signatures/i);
  await page.keyboard.press('Enter');
  checks.push('keyboard-accessible approval disclosure explains manifest + two chunk writes + completion; static Ready/Store/Verify labels removed');
  await page.locator('#tab-upload').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-open').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#tab-open').evaluate(node => node === document.activeElement), true);
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tab-upload').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#tab-open').getAttribute('tabindex'), '-1');
  checks.push('keyboard tabs select and focus the matching panel; only active tab is in the tab sequence');
  assert.equal(await page.locator('#rpc').count(), 0);
  assert.equal(await page.locator('#consent').count(), 0);
  assert.equal(await page.locator('#selected-name').innerText(), 'arkiv-demo.txt');
  await capture('baseline');
  checks.push('default sample selected; no RPC or acknowledgment input; 1440x900 primary action visible without scrolling');

  heldSend = new Promise(resolve => { releaseSend = resolve; });
  await page.locator('#upload').click();
  await page.locator('#workflow-status[data-state="loading"]').waitFor();
  await capture('loading');
  assert.equal(await page.locator('#upload').isDisabled(), true);
  releaseSend(); heldSend = undefined;
  await state('success');
  const demoBytes = Buffer.from(('Hello from Arkiv!\nThis public sample file is split into queryable chunks, then reconstructed and verified.\n').repeat(1200).slice(0, 120001));
  assert.equal(demoBytes.length, 120001);
  const demoKey = await assertDownload(demoBytes, 'arkiv-demo.txt');
  await assertChunks(demoBytes);
  assert.equal(rpc.transactions.length, 4);
  await capture('success');
  await page.locator('#query-details summary').click();
  await page.locator('#chunk-list article').first().locator('details summary').click();
  await capture('expanded-query');
  await page.locator('#query-details summary').click();
  await page.locator('#chunk-list article').first().locator('details summary').click();
  checks.push('120001-byte demo:4 SDK transactions; automatic exact file download; displayed SDK query retrieves both actual chunk keys/attributes/payloads; individual payload downloads reassemble original');

  const bytes = Buffer.from('Public synthetic fixture.\n'.repeat(11000));
  const beforeCustom = rpc.transactions.length;
  const customKey = await upload(bytes, 'synthetic-long-file-name-for-layout-and-integrity-verification.bin');
  assert.equal(bytes.length, 286000);
  assert.equal(rpc.transactions.length - beforeCustom, 5);
  await capture('long-filename');
  checks.push('custom286000-byte file:3 chunks,5 transactions, automatic exact-byte download');

  const customChunk = rpc.entities.find(entity => entity.attributes.some(a => a.name === 'manifest' && a.value === customKey));
  customChunk.payload = '0x' + '00'.repeat((customChunk.payload.length - 2) / 2);
  await page.locator('#tab-open').click();
  await page.locator('#manifest').fill(customKey);
  await page.locator('#retrieve').click();
  await state('error');
  assert.match(await page.locator('#workflow-status').innerText(), /integrity verification|invalid/);
  assert.equal(await page.locator('#save').isVisible(), false);
  assert.equal(await page.locator('#save').getAttribute('href'), null);
  checks.push('same-length corruption rejects reconstruction and clears previous download URL');

  await page.locator('#tab-upload').click();
  await upload(Buffer.alloc(0), 'empty.bin');
  checks.push('zero-byte upload and empty attachment pass automatic verification');

  rejectSend = true;
  let before = rpc.transactions.length;
  await page.locator('#upload').click(); await state('error');
  assert.equal(rpc.transactions.length, before);
  assert.equal(await page.locator('#save').isVisible(), false);
  assert.match(await page.locator('#workflow-status').innerText(), /not be confirmed|declined/);
  await capture('error');
  checks.push('rejected wallet approval sends zero transactions and leaves no stale download');
  rejectSend = false;

  changeAfterSend = true; before = rpc.transactions.length;
  await page.locator('#upload').click(); await state('error');
  assert.equal(rpc.transactions.length, before + 1);
  assert.equal(await page.locator('#result-title').innerText(), 'Upload status unconfirmed');
  assert.match(await page.locator('#manifest').inputValue(), /^0x[0-9a-f]{64}$/);
  assert.equal(await page.locator('#chunk-list article').count(), 0);
  assert.equal(await page.locator('#save').isVisible(), false);
  checks.push('account changes after manifest: guard aborts before next write; partial key remains inspectable');

  await reset(); walletChain = '0x1'; before = rpc.transactions.length;
  await page.locator('#upload').click(); await state('error');
  assert.equal(rpc.transactions.length, before);
  assert.match(await page.locator('#workflow-status').innerText(), /Tiramisu/);
  walletChain = '0x7614d1';
  checks.push('wallet remaining on wrong network after switch request sends zero transactions');

  await reset(); await page.evaluate(() => { window.ethereum = undefined; }); before = rpc.transactions.length;
  await page.locator('#upload').click(); await state('error');
  assert.match(await page.locator('#workflow-status').innerText(), /No wallet found/);
  assert.equal(rpc.transactions.length, before);
  await page.locator('#tab-open').click(); await page.locator('#manifest').fill(demoKey);
  await page.locator('#retrieve').click(); await state('success');
  await assertDownload(demoBytes, 'arkiv-demo.txt');
  await assertChunks(demoBytes);
  assert.equal(rpc.transactions.length, before);
  checks.push('missing wallet prevents writes; open-existing still retrieves verified file without wallet');

  await reset(); before = rpc.transactions.length;
  await page.locator('#expiration').fill('2000-01-01T12:00');
  // Browser constraint validation must reject the date before any transaction request.
  await page.locator('#upload').click();
  assert.equal(await page.locator('#expiration').evaluate(node => node.checkValidity()), false);
  assert.equal(rpc.transactions.length, before);
  await reset(); staleTiming = true;
  await page.locator('#upload').click(); await state('error');
  assert.match(await page.locator('#workflow-status').innerText(), /five minutes/);
  assert.equal(rpc.transactions.length, before);
  staleTiming = false;
  checks.push('past date browser validation and stale network timing both prevent writes');

  await reset(); failAfterFinalize = true; before = rpc.transactions.length;
  await page.locator('#upload').click(); await state('error');
  assert.equal(rpc.transactions.length, before + 4);
  assert.equal(await page.locator('#result-title').innerText(), 'Stored. Verification not completed.');
  assert.match(await page.locator('#workflow-status').innerText(), /upload is confirmed/);
  assert.equal(await page.locator('#retry').isVisible(), true);
  assert.equal(await page.locator('#save').isVisible(), false);
  await page.screenshot({ path: join(out, 'sample-stored-verification-failed.png'), fullPage: true });
  readFailure = false; failAfterFinalize = false; before = rpc.transactions.length;
  await page.locator('#retry').click(); await state('success');
  await assertDownload(demoBytes, 'arkiv-demo.txt');
  await assertChunks(demoBytes);
  assert.equal(rpc.transactions.length, before);
  checks.push('read failure after final receipt preserves confirmed storage; retry verifies/downloads with zero additional transactions');

  await reset(); inspectionFailure = true; before = rpc.transactions.length;
  await page.locator('#tab-open').click(); await page.locator('#manifest').fill(demoKey);
  await page.locator('#retrieve').click(); await state('success');
  assert.equal(await page.locator('#inspection-status').getAttribute('data-state'), 'error');
  assert.equal(await page.locator('#retry-inspection').isVisible(), true);
  assert.equal(await page.locator('#chunk-list article').count(), 0);
  await assertDownload(demoBytes, 'arkiv-demo.txt');
  await page.screenshot({ path: join(out, 'sample-inspection-read-failed.png'), fullPage: true });
  inspectionFailure = false;
  await page.locator('#retry-inspection').click();
  await page.locator('#inspection-status[data-state="success"]').waitFor(); await idle();
  await assertChunks(demoBytes);
  assert.equal(rpc.transactions.length, before);
  checks.push('inspection-only RPC failure preserves verified download; details retry restores real chunks and sends zero transactions');

  assert.deepEqual(errors, []);
  await fs.writeFile(join(out, 'sample-flow-results.json'), JSON.stringify({ checks, geometry, browser: browser.version(), source: 'real package + real SDK with controlled in-memory RPC and injected wallet; isolated browser; no live chain writes', transactions: rpc.transactions, errors, firstManifestKey: demoKey }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, transactions: rpc.transactions.length, artifacts: out }));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(out, 'sample-test-failure.png'), fullPage: true }).catch(() => {});
    console.error('Visible status:', await page.locator('#workflow-status').textContent().catch(() => 'unavailable'));
  }
  throw error;
} finally { await browser.close(); }
