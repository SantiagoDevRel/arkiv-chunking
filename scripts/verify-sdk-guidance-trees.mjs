// Reproduce the current guard against exact historical and PR source trees without chain access.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),manifest=JSON.parse(fs.readFileSync('package.json','utf8'));
const repo=manifest.name==='arkiv-encryption'?'arkiv-encrypted-entities':manifest.name;
assert.ok(['arkiv-chunking','arkiv-images','arkiv-encrypted-entities'].includes(repo));
const args=process.argv.slice(2),base=args[args.indexOf('--base')+1],head=args[args.indexOf('--head')+1];
assert.ok(args.includes('--base')&&args.includes('--head')&&/^[a-f0-9]{40}$/.test(base)&&/^[a-f0-9]{40}$/.test(head),'Pass full --base and --head commit hashes.');
const outIndex=args.indexOf('--out');
assert.ok(outIndex<0||args[outIndex+1]&&!args[outIndex+1].startsWith('--'),'Pass a directory after --out.');
assert.ok(process.env.TMPDIR,'Run in a registered DGX job with private TMPDIR.');
const checkout=fs.realpathSync(root);
function outsideCheckout(candidate){
 const relative=path.relative(checkout,candidate);
 assert.ok(relative&&(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)),'Temporary and output directories must be outside the checkout.');
}
outsideCheckout(fs.realpathSync(os.tmpdir()));
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-guidance-trees-'));
function run(command,args,cwd=stage){const p=spawnSync(command,args,{cwd,encoding:'utf8',maxBuffer:20*1024*1024});assert.equal(p.status,0,p.stdout+'\n'+p.stderr);return p.stdout.trim();}
function archive(ref,label){
 const tree=path.join(stage,label);fs.mkdirSync(tree);
 const tar=path.join(stage,label+'.tar');run('git',['--git-dir',path.join(stage,'objects.git'),'archive','--format=tar','--output',tar,ref]);run('tar',['-xf',tar,'-C',tree]);return tree;
}
try{
 const objects=path.join(stage,'objects.git');run('git',['init','--bare',objects]);
 const url=`https://github.com/SantiagoDevRel/${repo}.git`;
 run('git',['--git-dir',objects,'fetch','--no-tags','--depth=1',url,base,head]);
 const tree=ref=>run('git',['--git-dir',objects,'rev-parse',ref+'^{tree}']);
 const baseTree=tree(base),headTree=tree(head),oldRoot=archive(base,'base'),headRoot=archive(head,'head');
 const guard=path.join(headRoot,'scripts/sdk-guidance-guard.mjs');
 const sha=file=>createHash('sha256').update(fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')).digest('hex');
 // Refuse evidence if the running workspace's guard or allowlist differs from the named PR head.
 for(const file of ['scripts/sdk-guidance-guard.mjs','sdk-guidance-history.json','scripts/verify-sdk-guidance-trees.mjs'])assert.equal(sha(path.join(root,file)),sha(path.join(headRoot,file)),`Workspace differs from PR head: ${file}`);
 let output;
 if(outIndex<0)output=fs.mkdtempSync(path.join(os.tmpdir(),'sdk-guidance-evidence-'));
 else{
  const requested=path.resolve(args[outIndex+1]);
  const candidate=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested));
  outsideCheckout(candidate);
  const existing=fs.lstatSync(candidate,{throwIfNoEntry:false});
  assert.ok(!existing||existing.isDirectory()&&!existing.isSymbolicLink(),'Output must be a directory, not a file or symlink.');
  if(!existing)fs.mkdirSync(candidate,{mode:0o700});
  output=fs.realpathSync(candidate);
 }
 outsideCheckout(output);
 for(const name of ['guard-red-base.log','guard-green-head.log'])assert.ok(!fs.lstatSync(path.join(output,name),{throwIfNoEntry:false}),`Evidence already exists: ${path.join(output,name)}`);
 console.log(JSON.stringify({evidenceDirectory:output}));
 for(const [label,target,commit,targetTree,expected]of [['red-base',oldRoot,base,baseTree,1],['green-head',headRoot,head,headTree,0]]){
  const command=[process.execPath,guard,target];
  const result=spawnSync(command[0],command.slice(1),{cwd:headRoot,encoding:'utf8',maxBuffer:20*1024*1024});
  const log=[`target_commit: ${commit}`,`target_tree: ${targetTree}`,`guard_source_commit: ${head}`,`guard_source_tree: ${headTree}`,`platform: ${process.platform} ${process.arch}`,`repository: ${url}`,`fetch_command: git --git-dir ${objects} fetch --no-tags --depth=1 ${url} ${base} ${head}`,`base_archive_command: git --git-dir ${objects} archive --format=tar --output ${path.join(stage,'base.tar')} ${base}`,`head_archive_command: git --git-dir ${objects} archive --format=tar --output ${path.join(stage,'head.tar')} ${head}`,`reproduce_command: node scripts/verify-sdk-guidance-trees.mjs --base ${base} --head ${head}`,`guard_command_argv: ${JSON.stringify(command)}`,`guard_cwd: ${headRoot}`,`expected_exit_code: ${expected}`,`actual_exit_code: ${result.status}`,'--- stdout ---',result.stdout,'--- stderr ---',result.stderr].join('\n')+'\n';
  fs.writeFileSync(path.join(output,`guard-${label}.log`),log,{flag:'wx',mode:0o600});
  assert.equal(result.status,expected,log);
  if(expected===1){assert.match(result.stderr,/current guidance must use the verified SDK pin/);assert.doesNotMatch(result.stderr,/ERR_MODULE_NOT_FOUND|SyntaxError/);}
  console.log(JSON.stringify({repository:repo,evidence:label,commit,tree:targetTree,guardSource:head,exit:result.status}));
 }
}finally{fs.rmSync(stage,{recursive:true});}
