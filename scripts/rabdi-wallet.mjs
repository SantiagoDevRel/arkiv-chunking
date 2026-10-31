// Retained script adapter: uploadFile supplies its public per-write estimated policy.
// Reject calls that bypass that policy; never substitute a fixed binary gas budget.
export function serialRabdiWallet(signer) {
  function checked(params) {
    if(!params || typeof params.gas!=='bigint' || params.gas<1000000n || typeof params.gasPrice!=='bigint' || params.gasPrice<=0n || !Number.isSafeInteger(params.nonce) || params.nonce<0)throw Error('Explicit estimated transaction parameters are required.');
    return params;
  }
  return {
    ...signer,
    createEntity:async(schema,values,options,params)=>signer.createEntity(schema,values,options,checked(params)),
    patchEntity:async(schema,entityKey,changes,params)=>signer.patchEntity(schema,entityKey,changes,checked(params)),
  };
}
