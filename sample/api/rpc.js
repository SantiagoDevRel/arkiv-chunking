// A bounded read proxy for this sample. No wallet keys, writes, arbitrary methods or arbitrary RPC URLs.
export const config = { maxDuration: 30 };
const allowedFields = new Set(['key','owner','creator','expiresAt','creationFlags','attributes','attributeSchema','createdAt','updatedAt']);
const allowedColumns = new Set(['type','complete','sha256','totalbytes','chunkcount','chunksize','metadata','manifest','seq','data']);
const usage = new Map();
const hex32 = '0x[0-9a-fA-F]{64}';
const address = '0x[0-9a-fA-F]{40}';
export function allowedQuery(params) {
  if (!Array.isArray(params) || params.length !== 2) return false;
  const [query, options] = params;
  if (typeof query !== 'string' || query.length > 2048 || !options || typeof options !== 'object') return false;
  if (Object.keys(options).some(k => !['select','limit'].includes(k))) return false;
  if (typeof options.limit !== 'string' || !/^0x[0-9a-f]+$/i.test(options.limit)) return false;
  const limit = Number(BigInt(options.limit));
  if (limit < 1 || limit > 100) return false;
  if (!options.select || typeof options.select !== 'object' || Array.isArray(options.select)) return false;
  for (const [field, value] of Object.entries(options.select)) {
    if (!allowedFields.has(field)) return false;
    if (field === 'attributes') {
      if (value === false) continue;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([k,v]) => !allowedColumns.has(k) || v !== true)) return false;
    } else if (typeof value !== 'boolean' || (field === 'attributeSchema' && value)) return false;
  }
  const clauses = [];
  const pattern = new RegExp('(\\$key|\\$owner|\\$creator|manifest|type)\\s*(=|>)\\s*(key|addr|str)\\(([^)]*)\\)', 'g');
  const remainder = query.replace(pattern, (_,name,op,type,value) => {
    clauses.push({name,op,type,value}); return '_';
  });
  const rest = remainder.replace(/ORDER BY\s+\$key:key\s+ASC/g, '#');
  if (!/^[\s()_#AND]*$/.test(rest) || (rest.match(/#/g)?.length ?? 0) > 1) return false;
  if (clauses.length === 1) {
    const c = clauses[0];
    return c.name === '$key' && c.op === '=' && c.type === 'key' && new RegExp('^'+hex32+'$').test(c.value) && limit === 1;
  }
  const names = clauses.map(c => c.name);
  if (clauses.length < 4 || clauses.length > 5 || new Set(names).size !== names.length) return false;
  for (const c of clauses) {
    if (c.name === 'type') { if (c.op !== '=' || c.type !== 'str' || c.value !== "'arkiv-chunking/chunk/v2'") return false; }
    else if (c.name === 'manifest' || c.name === '$key') {
      if (c.type !== 'key' || c.op !== (c.name === '$key' ? '>' : '=') || !new RegExp('^'+hex32+'$').test(c.value)) return false;
    } else if (c.type !== 'addr' || c.op !== '=' || !new RegExp('^'+address+'$').test(c.value)) return false;
  }
  return ['type','manifest','$owner','$creator'].every(name => names.includes(name)) && rest.includes('#');
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  const send = (status, body) => res.status(status).json(body);
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return send(405,{error:'Use POST.'}); }
  const origin = req.headers?.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return send(403,{error:'Origin not allowed.'}); }
    catch { return send(403,{error:'Origin not allowed.'}); }
  }
  if (Number(req.headers?.['content-length'] ?? 0) > 8192) return send(413,{error:'Request too large.'});
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return send(400,{error:'Invalid JSON.'}); }
  if (!body || Array.isArray(body) || JSON.stringify(body).length > 8192 || body.jsonrpc !== '2.0' ||
      !['string','number'].includes(typeof body.id) ||
      !['eth_chainId','arkiv_getBlockTiming','eth_getBlockByNumber','arkiv_query'].includes(body.method) ||
      (body.method === 'arkiv_query' ? !allowedQuery(body.params) : body.method === 'eth_getBlockByNumber'
        ? !Array.isArray(body.params) || body.params.length !== 2 || body.params[0] !== 'latest' || body.params[1] !== false
        : !Array.isArray(body.params) || body.params.length !== 0)) return send(400,{error:'Unsupported read request.'});
  // Best effort per-instance cap. Durable provider quotas remain authoritative.
  const now = Date.now(), identity = String(req.headers?.['x-real-ip'] ?? 'shared').slice(0,100);
  for (const [key,entry] of usage) if (now-entry.start >= 60000) usage.delete(key);
  const entry = usage.get(identity) ?? {start:now,count:0};
  if (entry.count >= 120 || usage.size > 5000) return send(429,{error:'Read limit reached. Try again later.'});
  entry.count++; usage.set(identity,entry);
  if (!process.env.ARKIV_ACCESS_KEY) return send(503,{error:'Server access key is not configured. Obtain one at https://hub.arkiv.network/access-keys.'});
  try {
    const upstream = await fetch('https://rpc.rabdi.db-chain.testnet.arkiv.network/'+encodeURIComponent(process.env.ARKIV_ACCESS_KEY), {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), cache:'no-store', signal:AbortSignal.timeout(20000),
    });
    if (!upstream.ok) throw Error('Upstream unavailable');
    const response = await upstream.json();
    if (response.error || !Object.hasOwn(response,'result') || JSON.stringify(response).length > 3500000) throw Error('Upstream read failed');
    return send(200,{jsonrpc:'2.0',id:body.id,result:response.result});
  } catch {
    return send(502,{jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'Rabdi read unavailable. Try again later.'}});
  }
}
