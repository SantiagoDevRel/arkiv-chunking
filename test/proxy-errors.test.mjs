import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from 'node:util';
import handler from '../sample/api/rpc.js';
const fakeURL='https://rpc.rabdi.db-chain.testnet.arkiv.network/synthetic-demo-key';
const marker='SYNTHETIC_PROVIDER_MARKER';
async function invoke(mode,headers={host:'sample.example',origin:'https://sample.example','content-type':'application/json'}){
 const previousFetch=globalThis.fetch,oldKey=process.env.ARKIV_ACCESS_KEY,methods=['log','info','warn','error','debug'],oldConsole=methods.map(n=>console[n]),logs=[];let calls=0,thrown;
 const error=Object.assign(new Error(marker+' '+fakeURL,{cause:new Error(fakeURL)}),{details:{url:fakeURL}});
 process.env.ARKIV_ACCESS_KEY='synthetic-demo-key';methods.forEach(n=>console[n]=(...args)=>logs.push(inspect(args,{depth:20})+' '+JSON.stringify(args)));
 globalThis.fetch=async()=>{calls++;if(mode==='throw')throw error;if(mode==='http')return new Response(marker+' '+fakeURL,{status:429});return new Response(JSON.stringify(mode==='success'?{jsonrpc:'2.0',id:1,result:'0x76edaf'}:{jsonrpc:'2.0',id:1,error:{code:-32000,message:marker+' '+fakeURL,data:{cause:fakeURL}}}));};
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
 try{try{await handler({method:'POST',headers,body:{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}},res);}catch(e){thrown=e;}return{status:res.statusCode,body:res.body,logs,calls,thrown,serializedThrown:inspect(thrown,{depth:20})+' '+JSON.stringify(thrown)};}
 finally{globalThis.fetch=previousFetch;methods.forEach((n,i)=>console[n]=oldConsole[i]);if(oldKey===undefined)delete process.env.ARKIV_ACCESS_KEY;else process.env.ARKIV_ACCESS_KEY=oldKey;}
}
for(const mode of ['throw','http','rpc'])test('public '+mode+' failures discard provider text, keyed URLs and causes',async()=>{
 const r=await invoke(mode);assert.equal(r.calls,1);assert.equal(r.status,502);assert.equal(r.thrown,undefined);assert.deepEqual(r.body,{jsonrpc:'2.0',id:1,error:{code:-32000,message:'Rabdi read unavailable. Try again later.'}});
 const exposed=JSON.stringify(r.body)+r.logs.join('')+r.serializedThrown;for(const value of [fakeURL,marker,'synthetic-demo-key','rpc.rabdi.db-chain.testnet.arkiv.network'])assert.equal(exposed.includes(value),false);assert.deepEqual(r.logs,[]);
});
for(const host of ['localhost:443','127.0.0.1:443'])test('HTTP local port 443 remains explicit for '+host,async()=>{const r=await invoke('success',{host,origin:'http://'+host,'content-type':'application/json'});assert.equal(r.status,200);assert.equal(r.calls,1);assert.equal(r.body.result,'0x76edaf');});
