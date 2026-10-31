import type { PublicArkivClient } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/schema';
import { and, asc, eq, gt, type Expression } from '@arkiv-network/sdk/query';
import { reconstructFile, type DownloadResult } from 'arkiv-chunking';
import { hexToBytes, type Hex } from 'viem';

/** Actual entity presentation; the package owns complete file verification. */
export async function inspectChunks(client: PublicArkivClient, manifestKey: Hex, verified: DownloadResult) {
  const page = await client.select({ $owner: true, $creator: true })
    .where(eq('$key', key(manifestKey))).limit(1).fetch();
  const manifest = page.entities[0];
  if (!manifest || ![manifest.$owner,manifest.$creator].every(a => /^0x[0-9a-fA-F]{40}$/.test(a))) throw Error('Manifest unavailable');
  const chunks = [];
  let lastKey: Hex | undefined;
  for (;;) {
    const filters: Expression[] = [eq('manifest',key(manifestKey)),eq('type',str('arkiv-chunking/chunk/v2'))];
    if (lastKey) filters.push(gt('$key',key(lastKey)));
    const result = await client.select({$key:true,seq:true,data:true})
      .where(and(...filters)).ownedBy(manifest.$owner).createdBy(manifest.$creator)
      .orderBy(asc('$key')).limit(8).fetch();
    for (const entity of result.entities) {
      if (chunks.length >= verified.chunkCount || !/^0x[0-9a-fA-F]{64}$/.test(entity.$key) ||
          (lastKey && entity.$key.toLowerCase() <= lastKey.toLowerCase())) throw Error('Unexpected chunk count or key');
      const seq = entity.seq;
      if (seq?.type !== 'u64' || seq.value < 0n || seq.value >= BigInt(verified.chunkCount) ||
          entity.data?.type !== 'bytes' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(entity.data.value) ||
          entity.data.value.length > 240002) throw Error('Invalid chunk');
      chunks.push({key:entity.$key,seq:Number(seq.value),data:hexToBytes(entity.data.value),attributes:{manifest: {type:'key',value:manifestKey},seq,data:entity.data}});
      lastKey = entity.$key;
    }
    if (result.entities.length < 8) break;
  }
  chunks.sort((a,b) => a.seq-b.seq);
  if (chunks.length !== verified.chunkCount || chunks.some((c,i) => c.seq !== i)) throw Error('Incomplete chunks');
  await reconstructFile(chunks.map(c => c.data),verified.sha256);
  const code = [
    '// Repeat with gt("$key", key(lastKey)) for later pages; each query reads the latest block.',
    'const page = await client.select({ $key: true, seq: true, data: true })',
    '  .where(and(',
    '    eq("manifest", key("' + manifestKey + '")),',
    '    eq("type", str("arkiv-chunking/chunk/v2")),',
    '  ))',
    '  .ownedBy("' + manifest.$owner + '")',
    '  .createdBy("' + manifest.$creator + '")',
    '  .orderBy(asc("$key")).limit(8).fetch();',
  ].join('\n');
  return {chunks,code};
}
