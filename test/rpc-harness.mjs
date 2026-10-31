// Controlled in-memory RPC for contract/UI tests. This is NOT an Arkiv node.
// ABI structs checked against SDK 1.0.0; the SDK itself encodes all writes.
import { decodeFunctionData, decodeAbiParameters, encodeAbiParameters, encodeEventTopics, hexToString, parseAbi, parseAbiParameters, toHex } from 'viem';
import { ENTITY_EVENTS_ABI } from '@arkiv-network/sdk/entity';
// Protocol tags checked against SDK 1.0 src/entity/params.ts; not a public SDK export.
const OperationType = {Create: 1, Patch: 2};

const executeAbi = parseAbi(['function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)']);
const createParams = parseAbiParameters('(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, (bytes32 name, uint8 typeId, bytes value)[] attributes)');
const patchParams = parseAbiParameters('(bytes32 entityKey, (bytes32 name, uint8 typeId, bytes value)[] mutations)');
const tags = { 1: 'bool', 2: 'i32', 3: 'u64', 4: 'u256', 5: 'dec', 6: 'bytes32', 7: 'bytes', 8: 'str', 9: 'addr', 10: 'key' };
const id = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const opAddress = '0x4400000000000000000000000000000000000044';
export const TEST_ACCOUNT = `0x${'12'.repeat(20)}`;

export function rpcHarness({revertAt=[],exhaustGas=false,omitLogsAt=[]}={}) {
  const entities = [], transactions = [], requests = [];
  const receipts = new Map();
  let block = 42;
  function applyAttributes(entity, attributes) {
    for (const a of attributes) {
      const name = hexToString(a.name, { size: 32 });
      const type = tags[a.typeId & 127];
      if (!type) throw Error(`Unhandled attribute type ${a.typeId}`);
      const value = type === 'str' ? hexToString(a.value) : type === 'bool' ? BigInt(a.value) === 1n : type === 'u64' ? toHex(BigInt(a.value)) : a.value;
      const old = entity.attributes.find(x => x.name === name);
      const indexed = Boolean(a.typeId & 128);
      if (old) Object.assign(old, { type, value, indexed }); else entity.attributes.push({ name, type, value, indexed });
    }
  }
  async function request({ method, params = [] }) {
    requests.push({ method, params });
    if (method === 'eth_chainId') return toHex(7794095);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [TEST_ACCOUNT];
    if (method === 'eth_blockNumber') return toHex(block);
    if (method === 'arkiv_getBlockTiming') return { current_block: toHex(block), current_block_time: Math.floor(Date.now() / 1000), duration: 2 };
    if (method === 'eth_getBalance') return toHex(10n ** 20n);
    if (method === 'eth_estimateGas') {
      if(params[1]!=='latest')throw Error('Gas estimation requires latest state');
      return toHex(params[0].data.length>200000?4904531:200000);
    }
    if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x1';
    if (method === 'eth_getTransactionCount') return toHex(transactions.length);
    if (method === 'eth_getTransactionReceipt') return receipts.get(params[0]) ?? null;
    if (method === 'eth_getBlockByNumber') return { number: toHex(block), hash: id(block), parentHash: id(block - 1), timestamp: toHex(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', gasLimit: '0x10000000', gasUsed: '0x0', transactions: [] };
    if (method === 'eth_sendTransaction') {
      const tx = params[0];
      if (tx.to.toLowerCase() !== opAddress) throw Error('Unexpected target');
      const { args } = decodeFunctionData({ abi: executeAbi, data: tx.data });
      const hash = id(1000 + transactions.length), logs = [];
      transactions.push({ hash, calldataBytes: (tx.data.length - 2) / 2, ...tx });
      const reverted=revertAt.includes(transactions.length);
      block++;
      for (const operation of reverted?[]:args[0]) {
        if (operation.operation === OperationType.Create) {
          const input = decodeAbiParameters(createParams, operation.operationData)[0];
          const entityKey = id(entities.length + 1), minimum = BigInt(block) + input.minLifetime;
          const expiresAt = input.expiresAt > minimum ? input.expiresAt : minimum;
          const entity = { key: entityKey, owner: tx.from, creator: tx.from, attributes: [], expiresAt: toHex(expiresAt), creationFlags: { raw: input.creationFlags } };
          applyAttributes(entity, input.attributes); entities.push(entity);
          logs.push({ address: opAddress, topics: encodeEventTopics({ abi: ENTITY_EVENTS_ABI, eventName: 'EntityCreated', args: { entityKey, owner: tx.from } }), data: encodeAbiParameters(parseAbiParameters('uint64,uint8'), [expiresAt, input.creationFlags]) });
        } else if (operation.operation === OperationType.Patch) {
          const input = decodeAbiParameters(patchParams, operation.operationData)[0];
          const entity = entities.find(e => e.key === input.entityKey);
          if (!entity || entity.owner !== tx.from) throw Error('Patch owner mismatch');
          applyAttributes(entity, input.mutations);
        } else throw Error(`Unexpected operation ${operation.operation}`);
      }
      const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash: id(block), blockNumber: toHex(block), from: tx.from, to: opAddress, cumulativeGasUsed: '0x10000', gasUsed: reverted&&exhaustGas?tx.gas:'0x10000', effectiveGasPrice: '0x1', contractAddress: null, logsBloom: `0x${'00'.repeat(256)}`, status: reverted?'0x0':'0x1', type: '0x2', logs: (omitLogsAt.includes(transactions.length)?[]:logs).map((log, i) => ({ ...log, transactionHash: hash, transactionIndex: '0x0', blockHash: id(block), blockNumber: toHex(block), logIndex: toHex(i), removed: false })) };
      receipts.set(hash, receipt); return hash;
    }
    if (method === 'arkiv_query') {
      const [query, options] = params;
      let matches = /\$key = key/.test(query) ? entities.filter(e => query.toLowerCase().includes(e.key.toLowerCase())) : entities.filter(e => {
        const reference = e.attributes.find(a => a.name === 'manifest');
        return reference && query.includes(reference.value) && query.toLowerCase().includes(e.owner.toLowerCase()) && query.toLowerCase().includes(e.creator.toLowerCase());
      });
      const after = query.match(/\$key > key\((0x[0-9a-f]+)\)/)?.[1];
      matches = matches.filter(e => !after || e.key > after).sort((a,b) => a.key.localeCompare(b.key));
      const start = Number(BigInt(options.offset ?? '0x0')), limit = Number(BigInt(options.limit));
      const select = options.select;
      const data = matches.slice(start, start + limit).map(entity => Object.fromEntries(
        Object.entries(entity).filter(([field]) => select[field]).map(([field, value]) => [
          field, field === 'attributes' && typeof select.attributes === 'object'
            ? value.filter(attribute => select.attributes[attribute.name]) : value,
        ]),
      ));
      return { data, blockNumber: toHex(block) };
    }
    throw Error(`Unhandled RPC ${method}`);
  }
  return { request, entities, transactions, requests };
}
