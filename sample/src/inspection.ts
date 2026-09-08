import type { PublicArkivClient } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import { reconstructFile, type DownloadResult } from 'arkiv-chunking';
import type { Hex } from 'viem';

/** Read-only presentation data. The published package still owns file verification. */
export async function inspectChunks(client: PublicArkivClient, manifestKey: Hex, verified: DownloadResult) {
  const page = await client.select({ owner: true, creator: true })
    .where(eq('$key', key(manifestKey))).limit(1).fetch();
  const manifest = page.entities[0];
  if (!manifest) throw new Error('Manifest unavailable');
  if (![manifest.owner, manifest.creator].every(address => /^0x[0-9a-fA-F]{40}$/.test(address)) || typeof page.blockNumber !== 'bigint' || page.blockNumber < 0n) throw new Error('Invalid query scope');
  const query = client.select({ key: true, attributes: true, payload: true })
    .where(eq('manifest', key(manifestKey)), eq('type', str('arkiv-chunking/chunk/v1')))
    .ownedBy(manifest.owner).createdBy(manifest.creator).atBlock(page.blockNumber).limit(200);
  const chunks = [];
  for await (const entity of query) {
    if (chunks.length >= verified.chunkCount) throw new Error('Unexpected chunk count');
    const seq = entity.attributes.seq;
    if (seq?.type !== 'u64' || typeof seq.value !== 'bigint' || seq.value < 0n || seq.value >= BigInt(verified.chunkCount)) throw new Error('Unexpected chunk order');
    if (!/^0x[0-9a-fA-F]{64}$/.test(entity.key)) throw new Error('Invalid entity key');
    chunks.push({ ...entity, seq: Number(seq.value) });
  }
  chunks.sort((a, b) => a.seq - b.seq);
  if (chunks.length !== verified.chunkCount || chunks.some((chunk, index) => chunk.seq !== index)) throw new Error('Incomplete chunk inspection');
  // Do not label later, potentially changed query results as the verified file.
  await reconstructFile(chunks.map(chunk => chunk.payload), verified.sha256);
  const code = `const chunks = [];
for await (const entity of client
  .select({ key: true, attributes: true, payload: true })
  .where(
    eq('manifest', key('${manifestKey}')),
    eq('type', str('arkiv-chunking/chunk/v1')),
  )
  .ownedBy('${manifest.owner}')
  .createdBy('${manifest.creator}')
  .atBlock(${page.blockNumber}n)
  .limit(200)
) chunks.push(entity);`;
  return { chunks, code };
}
