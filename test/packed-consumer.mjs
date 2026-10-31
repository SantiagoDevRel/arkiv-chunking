// Run after npm pack through scripts/verify.mjs. All imports execute from a fresh installed consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('packed root API is additive, type-safe, and preserves SDK-success recovery without resending', {timeout:180000}, () => {
  const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
  const archive=process.env.CHUNKING_PACKED_TARBALL;
  assert.ok(archive && fs.existsSync(archive),'Run node scripts/verify.mjs to build and pack first.');
  const consumer=fs.mkdtempSync(path.join(process.env.TMPDIR,'chunking-packed-'));
  fs.writeFileSync(path.join(consumer,'package.json'),JSON.stringify({private:true,type:'module'}));
  const run=(command,args)=>{
    const environment={...process.env};
    delete environment.NODE_TEST_CONTEXT; // A nested node --test must start its own runner.
    const result=spawnSync(command,args,{cwd:consumer,encoding:'utf8',env:environment,timeout:120000});
    assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
    return result.stdout;
  };
  run('npm',['install','--no-audit','--no-fund',archive,'previous-chunking@npm:arkiv-chunking@1.0.0','@arkiv-network/sdk@1.0.0','viem@2.56.3']);
  // The patch intentionally changes policy error propagation. Check its public behavior below.
  fs.copyFileSync(new URL('./rpc-harness.mjs',import.meta.url),path.join(consumer,'rpc-harness.mjs'));
  fs.writeFileSync(path.join(consumer,'check.mjs'), `import assert from 'node:assert/strict';
import * as current from 'arkiv-chunking';
import * as previous from 'previous-chunking';
import {writeWithPolicy, WriteConfirmationPendingError, MIN_TRANSACTION_GAS, VERSION, splitFile, hashFile, reconstructFile} from 'arkiv-chunking';
import {createWalletClient, ExpirationTime, randomSalt} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {bytes, defineSchema} from '@arkiv-network/sdk/schema';
import {custom} from 'viem';
import {rpcHarness, TEST_ACCOUNT} from './rpc-harness.mjs';
assert.equal(VERSION,${JSON.stringify(version)});
assert.equal(current.MAX_EXPIRATION_BLOCKS,7883970);assert.equal(MIN_TRANSACTION_GAS,1000000n);
assert.equal(current.ChunkSchema.columns.data.isIndexed,false);assert.equal(current.ManifestSchema.columns.sha256.isIndexed,true);
assert.equal(previous.writeWithPolicy,undefined);assert.equal(previous.WriteConfirmationPendingError,undefined);
assert.deepEqual(Object.keys(current).sort(),[...Object.keys(previous),'writeWithPolicy','WriteConfirmationPendingError'].sort());
const original=new TextEncoder().encode('Packed root ESM consumer');
assert.deepEqual(await reconstructFile(splitFile(original,{chunkSize:5}),await hashFile(original)),original);
const Schema=defineSchema('consumer.binary.v1',{data:bytes()});
for(const scenario of ['success','delayed','pending']) {
  const rpc=rpcHarness();let reads=0,entityKey,callbackSeen=false,sendCount=0;
  const hashes=[],contexts=[];
  const provider={request:args=>{
    if(args.method==='eth_getTransactionReceipt'&&++reads>1){
      assert.ok(callbackSeen,'SDK-success recovery callback must precede receipt rechecks');
      assert.equal(hashes.length,1);
      if(scenario==='pending'||(scenario==='delayed'&&reads===2))return null;
    }
    return rpc.request(args);
  }};
  const wallet=createWalletClient({chain:rabdi({accessKey:'controlled-test'}),account:TEST_ACCOUNT,transport:custom(provider,{retryCount:0}),pollingInterval:1});
  const values={data:new Uint8Array([1,2,3])},options={expiration:ExpirationTime.atBlock(3642n),salt:randomSalt()};
  const operation=writeWithPolicy(wallet,{phase:'chunks',chunkIndex:0},
    unsigned=>unsigned.createEntity(Schema,values,options,{gas:MIN_TRANSACTION_GAS,gasPrice:1n,nonce:0}),
    params=>{sendCount++;assert.equal(params.nonce,0);assert.equal(params.gasPrice,3n);return wallet.createEntity(Schema,values,options,params);},hashes,
    context=>{contexts.push(context);return {gas:context.defaults.gas+123n,gasPrice:3n};},
    result=>{entityKey=result.entityKey;assert.deepEqual(hashes,[result.txHash]);callbackSeen=true;});
  if(scenario==='pending') {
    await assert.rejects(operation,error=>{
      assert.ok(error instanceof WriteConfirmationPendingError);assert.ok(error instanceof Error);
      assert.equal(error.name,'WriteConfirmationPendingError');assert.equal(error.txHash,rpc.transactions[0].hash);
      assert.deepEqual(hashes,[error.txHash]);assert.equal(entityKey,rpc.entities[0].key);return true;
    });
    assert.equal(reads,6); // One SDK receipt followed by the five bounded policy rechecks.
  }else{
    const result=await operation;assert.equal(result.entityKey,entityKey);assert.deepEqual(hashes,[result.txHash]);
    assert.equal(reads,scenario==='delayed'?3:2);
  }
  assert.equal(sendCount,1);assert.equal(rpc.transactions.length,1);assert.equal(contexts.length,1);
  assert.equal(BigInt(rpc.transactions[0].gas),contexts[0].defaults.gas+123n);
  assert.ok(contexts[0].defaults.gas>=MIN_TRANSACTION_GAS);assert.ok(contexts[0].defaults.gas>=2n*contexts[0].estimate);
  assert.ok(rpc.requests.filter(r=>r.method==='eth_estimateGas'||r.method==='eth_getTransactionCount').every(r=>r.params[1]==='latest'));
}
console.log('Packed root ESM exports, additive compatibility, explicit parameters and pending/delayed behavior passed.');
`);
  console.log(run(process.execPath,['check.mjs']).trim());
  const readme=fs.readFileSync(path.join(consumer,'node_modules/arkiv-chunking/README.md'),'utf8').replace(/\r\n/g,'\n');
  const example=readme.split('### Reuse the public write policy\n')[1]?.match(/```js\n([\s\S]*?)\n```/)?.[1];
  assert.ok(example,'The packaged README must contain the public write-policy example.');
  fs.writeFileSync(path.join(consumer,'readme-example.mjs'),example+'\nexport {storeBinary, binaryOperations};\n');
  fs.copyFileSync(new URL('./readme-policy-consumer.mjs',import.meta.url),path.join(consumer,'readme-policy-consumer.mjs'));
  const readmeResults=run(process.execPath,['--test','readme-policy-consumer.mjs']);
  assert.match(readmeResults,/tests\s+8/);assert.match(readmeResults,/pass\s+8/);
  console.log(readmeResults.trim());
  const regression=fs.readFileSync(new URL('./confirmation-pending.test.mjs',import.meta.url),'utf8')
    .replace("'../dist/index.js'", "'arkiv-chunking'");
  fs.writeFileSync(path.join(consumer,'confirmation-pending.test.mjs'),regression);
  const regressionResults=run(process.execPath,['--test','confirmation-pending.test.mjs']);
  assert.match(regressionResults,/pass\s+17/);assert.match(regressionResults,/fail\s+0/);
  console.log(regressionResults.trim());
  fs.writeFileSync(path.join(consumer,'check.ts'), `import {createPublicClient, createWalletClient, ExpirationTime, randomSalt} from '@arkiv-network/sdk';
import {bytes, defineSchema} from '@arkiv-network/sdk/schema';
import {rabdi} from '@arkiv-network/sdk/chains';
import {http, type Hex} from 'viem';
import {writeWithPolicy, WriteConfirmationPendingError, ChunkingError, MIN_TRANSACTION_GAS, ChunkSchema, ManifestSchema, downloadFile, type ChunkingPublicClient, type TransactionParameterPolicy, type WriteTransactionParameters} from 'arkiv-chunking';
const publicClient:ChunkingPublicClient=createPublicClient({chain:rabdi({accessKey:'controlled-test'}),transport:http()});void publicClient;void downloadFile;
const wallet=createWalletClient({chain:rabdi({accessKey:'controlled-test'}),account:'0x1212121212121212121212121212121212121212',transport:http()});
const schema=defineSchema('consumer.binary.v1',{data:bytes()}),values={data:new Uint8Array([1])};
const options={expiration:ExpirationTime.atBlock(3642n),salt:randomSalt()};
const hashes:Hex[]=[];
const policy:TransactionParameterPolicy=({defaults,estimate})=>({gas:defaults.gas+estimate});
const result=await writeWithPolicy(wallet,{phase:'chunks',chunkIndex:0},
  unsigned=>unsigned.createEntity(schema,values,options,{gas:MIN_TRANSACTION_GAS,gasPrice:1n,nonce:0}),
  (parameters:WriteTransactionParameters)=>wallet.createEntity(schema,values,options,parameters),hashes,policy,
  sdkResult=>{const entityKey:Hex=sdkResult.entityKey;void entityKey;});
const transaction:Hex=result.txHash;void transaction;
const pending:WriteConfirmationPendingError=new WriteConfirmationPendingError(result.txHash);
const saved:Hex=pending.txHash;void saved;
const uploadPending=new ChunkingError('CONFIRMATION_PENDING','Pending',{txHash:saved});
const submitted:Hex|undefined=uploadPending.txHash;void submitted;
function narrow(error:unknown){if(error instanceof WriteConfirmationPendingError){const hash:Hex=error.txHash;return hash;}}void narrow;
const storedOnly:false=ChunkSchema.columns.data.isIndexed;
const indexed:true=ManifestSchema.columns.sha256.isIndexed;void storedOnly;void indexed;
`);
  run(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'check.ts','--noEmit','--strict','--module','NodeNext','--target','ES2022','--skipLibCheck']);
});
