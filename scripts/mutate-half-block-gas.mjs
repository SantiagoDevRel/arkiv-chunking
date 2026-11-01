import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const file='dist/transactions.js',original=fs.readFileSync(file,'utf8');
assert.ok(original.includes('parameters.gas > quantity(block.gasLimit) / 2n'));
const mutants={fullBlock:original.replace('parameters.gas > quantity(block.gasLimit) / 2n','parameters.gas > quantity(block.gasLimit)'),removed:original.replace('parameters.gas > quantity(block.gasLimit) / 2n','false')};
try{
 for(const [name,text] of Object.entries(mutants)){
  assert.notEqual(text,original);fs.writeFileSync(file,text);const result=spawnSync(process.execPath,['--test','test/half-block-gas.test.mjs'],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
  assert.equal(result.status,1,'A weakened half-block bound must fail behavioral tests');assert.match(result.stdout,/# fail [1-9]/);fs.writeFileSync(process.env.TMPDIR+'/evidence/mutation-'+name+'.log',result.stdout+result.stderr);console.log(JSON.stringify({mutation:name,rejected:true,exit:result.status}));
 }
}finally{fs.writeFileSync(file,original);}
const restored=spawnSync(process.execPath,['--test','test/half-block-gas.test.mjs'],{encoding:'utf8'});assert.equal(restored.status,0,restored.stdout+restored.stderr);console.log('Both mutations rejected; generated runtime restored and all boundary tests pass');
