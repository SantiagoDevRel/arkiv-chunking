// Verify the still-published registry dependency independently of this source archive.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),{name}=JSON.parse(fs.readFileSync('package.json'));
const version=JSON.parse(fs.readFileSync('sample/package.json')).dependencies[name];
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'registry-sdk101-'));
function run(command,args){const env={...process.env};delete env.NODE_TEST_CONTEXT;const p=spawnSync(command,args,{cwd:stage,encoding:'utf8',env});assert.equal(p.status,0,p.stdout+'\n'+p.stderr);return p.stdout;}
try{
 fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({private:true,type:'module'}));
 run('npm',['install','--ignore-scripts','--save-exact','--no-audit','--no-fund',`${name}@${version}`,'@arkiv-network/sdk@1.0.1','viem@2.56.3']);
 const lock=JSON.parse(fs.readFileSync(path.join(stage,'package-lock.json')));
 assert.equal(lock.packages[`node_modules/${name}`].resolved,`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);assert.equal(lock.packages['node_modules/@arkiv-network/sdk'].version,'1.0.1');
 const checks=name==='arkiv-chunking'?`const bytes=new Uint8Array([0,1,255]);assert.deepEqual(await lib.reconstructFile(lib.splitFile(bytes),await lib.hashFile(bytes)),bytes);`:name==='arkiv-images'?`const bytes=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V+L2HwAG5AK4X5zdSAAAAABJRU5ErkJggg==','base64'));assert.equal(lib.inspectImage(bytes).byteLength,70);assert.equal(lib.planImage(bytes.length).mode,'inline');`:`const key=await lib.importKey(lib.generateKey()),bytes=new Uint8Array([0,1,255]);assert.deepEqual(await lib.decryptBytes(key,await lib.encryptBytes(key,bytes)),bytes);`;
 fs.writeFileSync(path.join(stage,'check.mjs'),`import assert from 'node:assert/strict';import * as lib from '${name}';assert.equal(lib.VERSION,'${version}');${checks}\n`);run(process.execPath,['check.mjs']);
 for(const guide of ['README.md','AGENTS.md','CLAUDE.md'])assert.ok(fs.statSync(path.join(stage,'node_modules',name,guide)).size);
 console.log(JSON.stringify({registryConsumer:true,name,version,sdk:'1.0.1',integrity:lock.packages[`node_modules/${name}`].integrity,passed:true}));
}finally{fs.rmSync(stage,{recursive:true});}
