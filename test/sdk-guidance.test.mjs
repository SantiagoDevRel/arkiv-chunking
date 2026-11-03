import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {checkTree,violations} from '../scripts/sdk-guidance-guard.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),old=[1,0,0].join('.');
test('whole tree uses verified SDK guidance',()=>assert.deepEqual(checkTree(root),[]));
test('SDK guidance CLI mutations reject installs, claims, dev pins, locks and every map string',()=>{
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-guidance-'));
 const run=()=>spawnSync(process.execPath,[path.join(root,'scripts/sdk-guidance-guard.mjs'),fixture],{encoding:'utf8'});
 const cases=[['README.md','npm install @arkiv-network/sdk@'+old],['AGENTS.md','Targets SDK '+old],['src/help.ts','Source https://unpkg.com/@arkiv-network/sdk@'+old+'/src/'],['template/package.json',JSON.stringify({dependencies:{'@arkiv-network/sdk':old}})],['sample/package-lock.json',JSON.stringify({packages:{'node_modules/@arkiv-network/sdk':{version:old}}})]];
 try{
  assert.equal(run().status,0);
  for(const [file,text]of cases){const p=path.join(fixture,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);assert.equal(run().status,1,file);fs.writeFileSync(p,file.endsWith('.json')?'{}':'SDK ^1.0, verified with 1.0.1');assert.equal(run().status,0);}
  const p=path.join(fixture,'dist/check.js.map');fs.mkdirSync(path.dirname(p),{recursive:true});
  for(const field of ['names','sources','file','sourceRoot','sourcesContent','extension']){fs.writeFileSync(p,JSON.stringify({version:3,[field]:['SDK '+old]}));assert.equal(run().status,1,field);}
  fs.writeFileSync(p,JSON.stringify({version:3,names:['verified with 1.0.1']}));assert.equal(run().status,0);
  assert.deepEqual(violations('package.json',JSON.stringify({peerDependencies:{'@arkiv-network/sdk':'^'+old}})),[]);
  console.log(JSON.stringify({sdkGuidanceMutation:true,sourceSurfaces:cases.length,mapFields:6,rejected:true}));
 }finally{fs.rmSync(fixture,{recursive:true});}
});
test('historical allowances require exact file, normalized content hash and listed lines',()=>{
 for(const entry of JSON.parse(fs.readFileSync(path.join(root,'sdk-guidance-history.json'),'utf8'))){
  const original=fs.readFileSync(path.join(root,entry.file),'utf8');assert.deepEqual(violations(entry.file,original),[]);
  assert.ok(violations(entry.file,original+'\nSDK '+old).length);
  assert.ok(violations('unlisted/'+entry.file,original).length);
 }
});
