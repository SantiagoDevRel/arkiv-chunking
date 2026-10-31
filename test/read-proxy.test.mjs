import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {custom} from 'viem';
import {downloadFile,uploadFile} from '../dist/index.js';
import handler, {allowedQuery} from '../sample/api/rpc.js';
import {rpcHarness,TEST_ACCOUNT} from './rpc-harness.mjs';
import {createWalletClient} from '@arkiv-network/sdk';
const chain=rabdi({accessKey:'controlled-test'});
test('proxy accepts actual SDK read queries including keyset pages, and rejects arbitrary access',async()=>{
  const rpc=rpcHarness();
  const c={publicClient:createPublicClient({chain,transport:custom(rpc,{retryCount:0})}),
    walletClient:createWalletClient({chain,account:TEST_ACCOUNT,transport:custom(rpc,{retryCount:0}),pollingInterval:1})};
  const stored=await uploadFile({...c,bytes:new Uint8Array(205),filename:'proxy.bin',expirationBlocks:3600,chunkSize:1});
  const before=rpc.requests.length;
  await downloadFile({publicClient:c.publicClient,manifestKey:stored.manifestKey});
  for(const request of rpc.requests.slice(before).filter(r=>r.method==='arkiv_query')) assert.equal(allowedQuery(request.params),true,request.params[0]);
  for(const params of [
    ['1 = 1',{select:{attributes:true},limit:'0x64'}],
    [`$key = key(${stored.manifestKey}) OR 1 = 1`,{select:{key:true},limit:'0x1'}],
    [`$key = key(${stored.manifestKey})`,{select:{attributes:true},limit:'0x1'}],
    [`$key = key(${stored.manifestKey})`,{select:{key:true},limit:'0x64'}],
  ]) assert.equal(allowedQuery(params),false);
});
function response(){return{statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.statusCode=s;return this;},json(b){this.body=b;return this;}};}

test('proxy accepts omitted params from viem no-argument HTTP requests',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.ARKIV_ACCESS_KEY;
  process.env.ARKIV_ACCESS_KEY='controlled-test';
  const forwarded=[];
  globalThis.fetch=async(_,options)=>{
    const request=JSON.parse(options.body);forwarded.push(request);
    return {ok:true,json:async()=>({jsonrpc:'2.0',id:request.id,result:'0x76edaf'})};
  };
  try {
    for(const method of ['eth_chainId','arkiv_getBlockTiming']) {
      const res=response();await handler({method:'POST',headers:{},body:{jsonrpc:'2.0',id:0,method}},res);
      assert.equal(res.statusCode,200);assert.equal(forwarded.at(-1).method,method);
    }
    for(const params of [null,{},['unexpected']]) {
      const res=response();await handler({method:'POST',headers:{},body:{jsonrpc:'2.0',id:0,method:'eth_chainId',params}},res);
      assert.equal(res.statusCode,400);
    }
    assert.equal(forwarded.length,2);
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.ARKIV_ACCESS_KEY;else process.env.ARKIV_ACCESS_KEY=oldKey;}
});
test('proxy rejects methods and cross-origin reads before accessing provider credentials',async()=>{
  for(const req of [
    {method:'GET',headers:{}},
    {method:'POST',headers:{origin:'https://foreign.example',host:'sample.example'},body:{}},
    {method:'POST',headers:{},body:{jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[]}},
    {method:'POST',headers:{},body:{jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['finalized',true]}},
  ]){const res=response();await handler(req,res);assert.ok([400,403,405].includes(res.statusCode));}
});
test('proxy failures contain no upstream URL or response',async()=>{
  const oldFetch=globalThis.fetch, oldKey=process.env.ARKIV_ACCESS_KEY;
  process.env.ARKIV_ACCESS_KEY='controlled-test';
  globalThis.fetch=async()=>{throw Error('Controlled sensitive upstream details');};
  try{
    const res=response();await handler({method:'POST',headers:{},body:{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}},res);
    assert.equal(res.statusCode,502);
    assert.doesNotMatch(JSON.stringify(res.body),/controlled-test|sensitive|https:/);
    assert.match(res.headers['Cache-Control'],/no-store/);
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.ARKIV_ACCESS_KEY;else process.env.ARKIV_ACCESS_KEY=oldKey;}
});
test('proxy forwards only the latest header-only block read needed by the gas-budget guard',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.ARKIV_ACCESS_KEY;
  process.env.ARKIV_ACCESS_KEY='controlled-test';
  globalThis.fetch=async(url,options)=>{
    assert.match(url,/^https:\/\/rpc\.rabdi\.db-chain\.testnet\.arkiv\.network\//);
    const request=JSON.parse(options.body);
    assert.equal(request.method,'eth_getBlockByNumber');assert.deepEqual(request.params,['latest',false]);
    return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:{gasLimit:'0x10000000'}})};
  };
  try {
    const res=response();await handler({method:'POST',headers:{},body:{jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]}},res);
    assert.equal(res.statusCode,200);assert.equal(res.body.result.gasLimit,'0x10000000');
  } finally {globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.ARKIV_ACCESS_KEY;else process.env.ARKIV_ACCESS_KEY=oldKey;}
});
