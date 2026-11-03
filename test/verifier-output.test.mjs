import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync as spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=fs.readFileSync(path.join(root,'scripts/verify-sdk-guidance-trees.mjs'),'utf8');
const base='a'.repeat(40),head='b'.repeat(40);

function fixture(){
 const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'verifier-output-test-'));
 const checkout=path.join(scratch,'checkout'),temp=path.join(scratch,'temp');
 fs.mkdirSync(checkout);fs.mkdirSync(temp);fs.mkdirSync(path.join(checkout,'scripts'));
 for(const file of ['package.json','sdk-guidance-history.json','scripts/sdk-guidance-guard.mjs','scripts/verify-sdk-guidance-trees.mjs'])fs.copyFileSync(path.join(root,file),path.join(checkout,file));
 function snapshot(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?snapshot(path.join(dir,e.name)):[[path.relative(checkout,path.join(dir,e.name)),createHash('sha256').update(fs.readFileSync(path.join(dir,e.name))).digest('hex')]]);}
 const before=snapshot(checkout);
 function execute(options=[],tmp=temp){
  const messages=[];
  const spawnSync=(command,args,config)=>{
   if(command==='git')return {status:0,stdout:args.includes('rev-parse')?((args.at(-1).startsWith(base)?'c':'d').repeat(40)+'\n'):'',stderr:''};
   if(command==='tar'){
    const target=args[args.indexOf('-C')+1];
    if(path.basename(target)==='head')fs.cpSync(checkout,target,{recursive:true});
    else fs.writeFileSync(path.join(target,'README.md'),'npm install @arkiv-network/sdk@'+[1,0,0].join('.'));
    return {status:0,stdout:'',stderr:''};
   }
   assert.equal(command,process.execPath);return spawn(command,args,config);
  };
  new vm.Script(source.replace(/^import .*;\r?\n/gm,''),{filename:'verify-sdk-guidance-trees.mjs'}).runInNewContext({fs,path,os:{tmpdir:()=>tmp},assert,createHash,spawnSync,process:{cwd:()=>checkout,argv:[process.execPath,'verifier','--base',base,'--head',head,...options],env:{TMPDIR:tmp},execPath:process.execPath,platform:process.platform,arch:process.arch},console:{log:text=>messages.push(JSON.parse(text))}});
  return messages;
 }
 return {scratch,checkout,temp,execute,unchanged:()=>assert.deepEqual(snapshot(checkout),before),close:()=>fs.rmSync(scratch,{recursive:true})};
}

test('verifier default logs go to a fresh private temp directory without checkout writes',()=>{
 const f=fixture();try{
  const first=f.execute(),second=f.execute();
  const a=first.find(x=>x.evidenceDirectory)?.evidenceDirectory,b=second.find(x=>x.evidenceDirectory)?.evidenceDirectory;
  assert.ok(a&&b,'print the private output directory');assert.notEqual(a,b);assert.equal(path.dirname(a),f.temp);
  assert.equal(first.find(x=>x.evidence==='red-base').exit,1);assert.equal(first.find(x=>x.evidence==='green-head').exit,0);
  if(process.platform!=='win32')assert.equal(fs.statSync(a).mode&0o777,0o700);
  for(const name of ['guard-red-base.log','guard-green-head.log']){assert.ok(fs.statSync(path.join(a,name)).isFile());if(process.platform!=='win32')assert.equal(fs.statSync(path.join(a,name)).mode&0o777,0o600);}
  f.unchanged();
 }finally{f.close();}
});
test('verifier explicit output is honored and refuses either existing log without partial writes',()=>{
 const f=fixture();try{
  const output=path.join(f.temp,'chosen');const messages=f.execute(['--out',output]);assert.equal(messages.find(x=>x.evidenceDirectory)?.evidenceDirectory,output);f.unchanged();
  for(const name of ['guard-red-base.log','guard-green-head.log']){
   const existing=fs.mkdtempSync(path.join(f.temp,'existing-'));fs.writeFileSync(path.join(existing,name),'caller evidence');
   assert.throws(()=>f.execute(['--out',existing]),/already exists|EEXIST/);
   assert.equal(fs.readFileSync(path.join(existing,name),'utf8'),'caller evidence');assert.deepEqual(fs.readdirSync(existing),[name]);
  }
  assert.throws(()=>f.execute(['--out']),/--out/);f.unchanged();
 }finally{f.close();}
});
test('verifier rejects direct and symlinked checkout output and checkout TMPDIR',()=>{
 const f=fixture();try{
  for(const output of [f.checkout,path.join(f.checkout,'new-output')])assert.throws(()=>f.execute(['--out',output]),/checkout/);
  const link=path.join(f.temp,'linked-checkout');fs.symlinkSync(f.checkout,link,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>f.execute(['--out',link]),/checkout|symlink/);assert.throws(()=>f.execute([],f.checkout),/checkout/);f.unchanged();
 }finally{f.close();}
});
