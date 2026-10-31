// One deliberately invalid public create. Never retries or uses the funder.
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient,ExpirationTime} from '@arkiv-network/sdk';
import {defineSchema,str} from '@arkiv-network/sdk/schema';
import {rabdi} from '@arkiv-network/sdk/chains';
import {http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const account=privateKeyToAccount(process.env.TEST_CHUNKING_PRIVATE_KEY);
assert.equal(account.address.toLowerCase(),process.env.TEST_CHUNKING_ADDRESS.toLowerCase());
assert.notEqual(account.address.toLowerCase(),'0x2f6e6adb6bc8f79799cb479fb5cb237fa3caa690');
const chain=rabdi({accessKey:process.env.ARKIV_ACCESS_KEY_A});
const transport=()=>http(undefined,{retryCount:0,timeout:30000});
const reader=createPublicClient({chain,transport:transport()});
const wallet=createWalletClient({chain,account,transport:transport()});
assert.equal(await reader.getChainId(),7794095);
const current=await reader.getBlockNumber({cacheTime:0});
const maxLifetime=7884000n,margin=120n,target=current+maxLifetime+margin;
const nonce=await reader.getTransactionCount({address:account.address,blockTag:'latest'});
const gasPrice=await reader.getGasPrice();
const report={network:'Rabdi',account:account.address,funderSigned:false,currentBlock:String(current),target:String(target),requestedMaxLifetime:String(maxLifetime),margin:String(margin),attempts:1,queries:0,startedAt:new Date().toISOString()};
try {
 const result=await wallet.createEntity(defineSchema('chunking-lifetime-probe-v1',{purpose:str()}),{purpose:'Public synthetic maximum-lifetime rejection probe'}, {expiration:ExpirationTime.atBlock(target)}, {gas:1000000n,gasPrice,nonce});
 report.unexpectedSuccess=result.txHash;process.exitCode=1;
} catch(error) {
 report.literalError=error.message;
 const hash=error.txHash;
 if(hash) {
  const [receipt,tx]=await Promise.all([reader.getTransactionReceipt({hash}),reader.getTransaction({hash})]);
  report.transactionHash=hash;report.status=receipt.status;report.blockNumber=String(receipt.blockNumber);report.gasUsed=String(receipt.gasUsed);report.gasLimit=String(tx.gas);
 }
 report.expectedRejection=/ExpiryBeyondMaxLifetime|maximum lifetime of 7884000 blocks/.test(error.message)&&/7884000/.test(error.message)&&report.status==='reverted';
 if(!report.expectedRejection)process.exitCode=1;
}
console.log(JSON.stringify({...report,finishedAt:new Date().toISOString()},null,2));
