import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient, createWalletClient, ExpirationTime, randomSalt} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {bytes, defineSchema} from '@arkiv-network/sdk/schema';
import {custom} from 'viem';
import {uploadFile, writeWithPolicy, WriteConfirmationPendingError, ChunkingError} from '../dist/index.js';
import {rpcHarness, TEST_ACCOUNT} from './rpc-harness.mjs';

const chain = rabdi({accessKey:'controlled-test'});
const Schema = defineSchema('pending.binary.v1', {data:bytes()});
const paths = [{name:'inline',write:1}, {name:'manifest',write:1}, {name:'chunk 2',write:3}, {name:'finalize',write:5}];

test('known submitted hashes survive unavailable receipts across direct and upload paths', {concurrency:true}, async t => {
  await Promise.all(paths.flatMap(path => ['success','throws'].flatMap(outcome => ['null','throws'].map(lookup =>
    t.test(`${path.name}: SDK ${outcome}, receipt ${lookup}`, async () => {
      const rpc = rpcHarness(), reads = new Map();
      let targetHash;
      const lookupError = Error('Receipt transport unavailable');
      const provider = {request:async args => {
        if (args.method === 'eth_getTransactionReceipt') {
          const hash = args.params[0];
          reads.set(hash, (reads.get(hash) ?? 0) + 1);
          if (hash === targetHash) {
            if (lookup === 'throws') throw lookupError;
            return null;
          }
        }
        return rpc.request(args);
      }};
      const wallet = createWalletClient({chain,account:TEST_ACCOUNT,transport:custom(provider,{retryCount:0}),pollingInterval:1});
      const publicClient = createPublicClient({chain,transport:custom(provider,{retryCount:0})});
      const wrap = method => async (...args) => {
        const result = await wallet[method](...args);
        if (rpc.transactions.length === path.write) {
          targetHash = result.txHash;
          if (outcome === 'throws') throw Object.assign(Error('SDK could not return the submitted result'), {txHash:targetHash});
        }
        return result;
      };
      const wrappedWallet = {...wallet, createEntity:wrap('createEntity'), patchEntity:wrap('patchEntity')};
      const hashes = [];
      const operation = path.name === 'inline'
        ? (() => {
          const values = {data:new Uint8Array([1,2,3])};
          const options = {expiration:ExpirationTime.atBlock(3642n),salt:randomSalt()};
          return writeWithPolicy(wrappedWallet,{phase:'manifest'},
            unsigned => unsigned.createEntity(Schema,values,options,{gas:1_000_000n,gasPrice:1n,nonce:0}),
            params => wrappedWallet.createEntity(Schema,values,options,params),hashes);
        })()
        : uploadFile({publicClient,walletClient:wrappedWallet,bytes:new Uint8Array([1,2,3]),chunkSize:1,filename:'pending.bin',expirationBlocks:3600});
      await assert.rejects(operation, error => {
        const pending = path.name === 'inline' ? error : error.cause;
        assert.ok(pending instanceof WriteConfirmationPendingError, 'known hash must produce a typed pending outcome');
        assert.equal(pending.txHash,targetHash);
        if (path.name === 'inline') {
          if (outcome === 'success') assert.deepEqual(hashes,[targetHash]);
          else assert.deepEqual(hashes,[], 'unverified error hash must not be labeled confirmed');
        } else {
          assert.ok(error instanceof ChunkingError);
          assert.equal(error.code,'CONFIRMATION_PENDING');
          if (outcome === 'throws') assert.equal(error.txHash,targetHash, 'upload callers need direct access to the unresolved hash');
          const confirmed = rpc.transactions.slice(0,outcome === 'success' ? path.write : path.write-1).map(tx=>tx.hash);
          assert.deepEqual(error.transactionHashes,confirmed);
          if (path.name !== 'manifest' || outcome === 'success') assert.equal(error.manifestKey,rpc.entities[0].key);
          const knownChunks = rpc.entities.slice(1,outcome === 'success' ? undefined : -1).map(entity=>entity.key);
          if (path.name === 'chunk 2') assert.deepEqual(error.chunkKeys,knownChunks);
        }
        return true;
      });
      assert.equal(rpc.transactions.length,path.write,'receipt uncertainty must never authorize another send');
      assert.equal(targetHash,rpc.transactions.at(-1).hash);
      assert.equal(reads.get(targetHash),outcome === 'success' ? 6 : 2);
    })
  ))));
});
