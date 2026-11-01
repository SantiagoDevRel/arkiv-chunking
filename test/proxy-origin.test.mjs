import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../sample/api/rpc.js';

const same = {host: 'sample.example', origin: 'https://sample.example', 'content-type': 'application/json'};
const cases = [
  ['strict Origin HTTP downgrade', {...same, origin: "http://sample.example"}, 403],
  ['strict Origin FTP scheme', {...same, origin: "ftp://sample.example"}, 403],
  ['strict Origin userinfo', {...same, origin: ['https://', 'user', ':', 'password', '@sample.example'].join('')}, 403],
  ['strict Origin path', {...same, origin: "https://sample.example/path"}, 403],
  ['strict Origin query', {...same, origin: "https://sample.example?x=1"}, 403],
  ['strict Origin fragment', {...same, origin: "https://sample.example#part"}, 403],
  ['strict Origin missing authority slashes', {...same, origin: "https:sample.example"}, 403],

  ['foreign JSON origin', {...same, origin: 'https://foreign.example'}, 403],
  ['foreign plain-text origin', {...same, origin: 'https://foreign.example', 'content-type': 'text/plain'}, 403],
  ['same-origin plain text', {...same, 'content-type': 'text/plain'}, 415],
  ['missing content type', {host: same.host, origin: same.origin}, 415],
  ['odd content type', {...same, 'content-type': 'application/jsonp'}, 415],
  ['ambiguous content type', {...same, 'content-type': 'application/json, text/plain'}, 415],
  ['array content type', {...same, 'content-type': ['application/json']}, 415],
  ['cross-site without origin', {host: same.host, 'content-type': 'application/json', 'sec-fetch-site': 'cross-site'}, 403],
  ['cross-site despite matching origin', {...same, 'sec-fetch-site': 'cross-site'}, 403],
  ['cross-site metadata with whitespace and case', {...same, 'sec-fetch-site': ' Cross-Site '}, 403],
  ['malformed origin', {...same, origin: 'invalid-origin'}, 403],
  ['opaque origin', {...same, origin: 'null'}, 403],
  ['empty origin', {...same, origin: ''}, 403],
  ['different origin port', {...same, origin: 'https://sample.example:444'}, 403],
  ['origin with no request host', {origin: same.origin, 'content-type': 'application/json'}, 403],
];

async function invoke(headers) {
  const previousFetch = globalThis.fetch, previousKey = process.env.ARKIV_ACCESS_KEY;
  let calls = 0;
  const res = {statusCode: 200, headers: {}, setHeader(k,v) {this.headers[k] = v;}, status(code) {this.statusCode = code; return this;}, json(body) {this.body = body; return this;}};
  process.env.ARKIV_ACCESS_KEY = 'example-test';
  globalThis.fetch = async () => {calls++; return new Response(JSON.stringify({jsonrpc: '2.0', id: 1, result: '0x76edaf'}));};
  try {
    await handler({method: 'POST', headers, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: []})}, res);
    return {status: res.statusCode, calls};
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.ARKIV_ACCESS_KEY; else process.env.ARKIV_ACCESS_KEY = previousKey;
  }
}

for (const [name, headers, expected] of cases) test(`read proxy rejects ${name} before spending a key`, async () => {
  const result = await invoke(headers);
  console.log(JSON.stringify({originCase: name, expected, status: result.status, upstreamCalls: result.calls}));
  assert.equal(result.calls, 0, 'rejected request must not reach upstream');
  assert.equal(result.status, expected);
});

for (const [name, headers] of [
  ['local HTTP localhost', {...same, host: 'localhost:17811', origin: 'http://localhost:17811'}],
  ['local HTTP loopback', {...same, host: '127.0.0.1:17811', origin: 'http://127.0.0.1:17811'}],
  ['same-origin JSON browser', {...same, 'sec-fetch-site': 'same-origin'}],
  ['same-origin JSON with charset', {...same, 'content-type': 'Application/JSON; charset=utf-8'}],
  ['origin absent for JSON clients', {host: same.host, 'content-type': 'application/json'}],
  ['matching non-default port', {...same, host: 'sample.example:444', origin: 'https://sample.example:444'}],
]) test(`read proxy allows ${name}`, async () => {
  const result = await invoke(headers);
  assert.equal(result.status, 200); assert.equal(result.calls, 1);
});
