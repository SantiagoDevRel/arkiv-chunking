// Lane W measured gas exhaustion with default estimates on Rabdi.
// Fresh latest nonces and network gas price are read separately before each serialized write.
// Binary creates use a larger explicit gas budget; live-smoke verifies that budget on real bytes.
export function serialRabdiWallet(signer, reader) {
  const address=typeof signer.account==='string'?signer.account:signer.account.address;
  async function parameters(gas) {
    const [nonce,gasPrice,block]=await Promise.all([
      reader.getTransactionCount({address,blockTag:'latest'}),
      reader.request({method:'eth_gasPrice'}),
      reader.getBlock({blockTag:'latest'}),
    ]);
    if(gas>block.gasLimit)throw Error('The verified transaction gas budget exceeds the current block limit.');
    return {nonce,gas,gasPrice:BigInt(gasPrice)};
  }
  return {
    ...signer,
    createEntity:async(schema,values,options)=>signer.createEntity(schema,values,options,await parameters(15000000n)),
    patchEntity:async(schema,entityKey,changes)=>signer.patchEntity(schema,entityKey,changes,await parameters(1000000n)),
  };
}
