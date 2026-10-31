import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const checks=[];
function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, {cwd, stdio:'inherit', env:process.env});
  checks.push({command,args:args.map(arg=>path.isAbsolute(arg)?path.basename(arg):arg),location:cwd===process.cwd()?'package':cwd.endsWith('sample')?'sample':'clean consumer',exitCode:result.status});
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('npm',['ci','--no-audit','--no-fund']);
const sdk = JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json','utf8'));
if (sdk.version !== '1.0.0' || !fs.existsSync('node_modules/@arkiv-network/sdk/src/schema/schema.ts')) throw Error('Installed SDK 1.0 source is required.');
console.log('SDK source available:', sdk.version);
run('npm',['test']);
run('npm',['run','typecheck']);
run('npm',['run','lint']);
run('npm',['pack']);
const tarball = path.resolve('arkiv-chunking-1.0.0.tgz');
const consumer = fs.mkdtempSync(path.join(process.env.TMPDIR, 'chunking-consumer-'));
fs.writeFileSync(path.join(consumer,'package.json'), JSON.stringify({private:true,type:'module'}));
run('npm',['install','--no-audit','--no-fund',tarball,'@arkiv-network/sdk@1.0.0','viem@2.56.3'],consumer);
fs.writeFileSync(path.join(consumer,'check.mjs'), `import assert from 'node:assert/strict';
import {splitFile,hashFile,reconstructFile,VERSION,ManifestSchema,ChunkSchema,MAX_EXPIRATION_BLOCKS,MIN_TRANSACTION_GAS} from 'arkiv-chunking';
const bytes = new TextEncoder().encode('Clean installed tarball consumer');
assert.equal(VERSION,'1.0.0');assert.equal(ChunkSchema.columns.data.isIndexed,false);
assert.equal(MAX_EXPIRATION_BLOCKS,7883970);assert.equal(MIN_TRANSACTION_GAS,1000000n);
assert.equal(ManifestSchema.columns.sha256.isIndexed,true);
assert.deepEqual(await reconstructFile(splitFile(bytes,{chunkSize:5}),await hashFile(bytes)),bytes);
console.log('Clean installed tarball ESM round trip passed.');
`);
run('node',['check.mjs'],consumer);
fs.writeFileSync(path.join(consumer,'check.ts'), `import {createPublicClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {http} from 'viem';
import {ChunkSchema,ManifestSchema,downloadFile,type ChunkingPublicClient,type TransactionParameterPolicy} from 'arkiv-chunking';
const client:ChunkingPublicClient=createPublicClient({chain:rabdi({accessKey:'controlled-test'}),transport:http()});
const storedOnly:false=ChunkSchema.columns.data.isIndexed;
const indexed:true=ManifestSchema.columns.sha256.isIndexed;
void storedOnly;void indexed;void downloadFile;
void client;
const policy:TransactionParameterPolicy=({defaults,attempt})=>({gas:defaults.gas+BigInt(attempt)});
void policy;
`);
run('node',[path.resolve('node_modules/typescript/bin/tsc'),'check.ts','--noEmit','--module','NodeNext','--target','ES2022','--skipLibCheck'],consumer);
// The candidate is deliberately unpublished. Only this preview build installs its actual tarball.
// A candidate can change without a version bump before publication. Never reuse a previous
// sample node_modules directory: npm may retain an older same-version tarball there.
const sampleDir=fs.mkdtempSync(path.join(process.env.TMPDIR,'chunking-sample-'));
fs.cpSync(path.resolve('sample'),sampleDir,{recursive:true,filter:source=>{
  const parts=path.relative(path.resolve('sample'),source).split(path.sep);
  return !parts.some(part=>['node_modules','dist','.vercel'].includes(part)||part.startsWith('.env'));
}});
const samplePackage=fs.readFileSync(path.join(sampleDir,'package.json'),'utf8');
run('npm',['install','--save-exact','--no-audit','--no-fund',tarball],sampleDir);
fs.writeFileSync(path.join(sampleDir,'package.json'),samplePackage);
const sampleLock=JSON.parse(fs.readFileSync(path.join(sampleDir,'package-lock.json'),'utf8'));
sampleLock.packages[''].dependencies['arkiv-chunking']='1.0.0';
// This is the future public location of these exact candidate bytes, not a publication claim.
sampleLock.packages['node_modules/arkiv-chunking'].resolved='https://registry.npmjs.org/arkiv-chunking/-/arkiv-chunking-1.0.0.tgz';
fs.writeFileSync('sample/package-lock.json',JSON.stringify(sampleLock,null,2)+'\n');
run('npm',['run','build'],sampleDir);
run('tar',['-czf','sample-preview.tgz','-C',sampleDir,'dist']);
const sdkFiles=['README.md','src/schema/schema.ts','src/clients/decorators/arkivWallet.ts','src/query/queryBuilder.ts'];
fs.writeFileSync('candidate-checks.json',JSON.stringify({
  status:'passed',platform:process.platform,arch:process.arch,node:process.version,sdk:sdk.version,
  viem:JSON.parse(fs.readFileSync('node_modules/viem/package.json','utf8')).version,
  typescript:JSON.parse(fs.readFileSync('node_modules/typescript/package.json','utf8')).version,
  installedSdkSources:Object.fromEntries(sdkFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync('node_modules/@arkiv-network/sdk/'+file)).digest('hex')])),
  checks,finishedAt:new Date().toISOString(),
},null,2));
console.log('Root tests, checks, packed consumer and candidate sample build passed.');
