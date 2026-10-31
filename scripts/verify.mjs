import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const checks=[];
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
function run(command, args, cwd = process.cwd(), environment = {}) {
  const result = spawnSync(command, args, {cwd, stdio:'inherit', env:{...process.env,...environment}});
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
const tarball = path.resolve(`arkiv-chunking-${version}.tgz`);
run('node',['--test','test/packed-consumer.mjs'],process.cwd(),{CHUNKING_PACKED_TARBALL:tarball});
// The candidate is deliberately unpublished. Only this preview build installs its actual tarball.
// A candidate can change without a version bump before publication. Never reuse a previous
// sample node_modules directory: npm may retain an older same-version tarball there.
const sampleDir=fs.mkdtempSync(path.join(process.env.TMPDIR,'chunking-sample-'));
fs.cpSync(path.resolve('sample'),sampleDir,{recursive:true,filter:source=>{
  const parts=path.relative(path.resolve('sample'),source).split(path.sep);
  return !parts.some(part=>['node_modules','dist','.vercel'].includes(part)||part.startsWith('.env'));
}});
run('npm',['install','--save-exact','--no-audit','--no-fund',tarball],sampleDir);
// The sample's published dependency stays unchanged in the checkout. Only this private
// build installs the archive, so verification cannot silently rewrite its release pin.
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
console.log('Root tests, checks, packed consumer and archive sample build passed.');
