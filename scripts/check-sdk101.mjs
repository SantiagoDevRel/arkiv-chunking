// Offline checks only. Network writes are deliberately a separate authorized operation.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {checkTree as checkSdk} from './sdk-guidance-guard.mjs';
import {checkTree as checkVocabulary} from './vocabulary-guard.mjs';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('package.json'));
function run(command,args,cwd=root){const p=spawnSync(command,args,{cwd,stdio:'inherit',env:process.env});assert.equal(p.status,0,`${command} failed`);}
assert.equal(JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json')).version,'1.0.1');
run('node',['scripts/verify.mjs']);
run('node',['scripts/sdk-peer-compatibility.mjs']);
run('node',['scripts/registry-sdk101.mjs']);
assert.deepEqual(checkSdk(root),[]);assert.deepEqual(checkVocabulary(root),[]);
const packed=spawnSync('npm',['pack','--ignore-scripts','--dry-run','--json'],{encoding:'utf8'});assert.equal(packed.status,0);const info=JSON.parse(packed.stdout)[0];
fs.mkdirSync('.sdk101',{recursive:true});fs.writeFileSync('.sdk101/pack-dry-run.json',JSON.stringify(info,null,2));
const extracted=fs.mkdtempSync(path.join(os.tmpdir(),'sdk101-packed-'));
try{
 run('tar',['-xzf',path.join(root,`${manifest.name}-${manifest.version}.tgz`),'-C',extracted]);
 assert.deepEqual(checkSdk(path.join(extracted,'package')),[]);assert.deepEqual(checkVocabulary(path.join(extracted,'package')),[]);
}finally{fs.rmSync(extracted,{recursive:true});}
console.log(JSON.stringify({sdk101:true,packedGuidance:true,packedVocabulary:true,packFiles:info.files.length,version:manifest.version}));
