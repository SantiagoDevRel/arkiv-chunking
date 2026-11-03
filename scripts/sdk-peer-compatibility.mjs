import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('package.json'));
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-peer-compatibility-'));
const old=[1,0,0].join('.');
const tests=manifest.name==='arkiv-chunking'?['test/sdk-compatibility.test.mjs','test/transaction-policy.test.mjs']:manifest.name==='arkiv-images'?['test/sdk-compatibility.test.mjs','test/inherited-policy.test.mjs']:['test/sdk-compatibility.test.mjs'];
function run(command,args){const env={...process.env};delete env.NODE_TEST_CONTEXT;const p=spawnSync(command,args,{cwd:stage,encoding:'utf8',env});if(p.stdout)process.stdout.write(p.stdout);if(p.stderr)process.stderr.write(p.stderr);assert.equal(p.status,0,command+' peer compatibility');if(args.includes('--test')){assert.match(p.stdout,/(?:#|ℹ) pass [1-9]/);assert.doesNotMatch(p.stderr,/skipping running files/);}}
try{
 for(const dir of ['dist','test',...(manifest.name==='arkiv-encryption'?['sample/src']:[])])fs.cpSync(path.join(root,dir),path.join(stage,dir),{recursive:true});
 fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:manifest.name,version:manifest.version,private:true,type:'module',exports:manifest.exports,dependencies:{...manifest.dependencies,'@arkiv-network/sdk':old,viem:'2.56.3'}}));
 run('npm',['install','--ignore-scripts','--no-audit','--no-fund']);
 run(process.execPath,['--test',...tests]);
 console.log(JSON.stringify({peerCompatibility:true,sdk:old,tests,success:true}));
}finally{fs.rmSync(stage,{recursive:true});}
