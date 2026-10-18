# @1888-labs/merkle-ethereum

Verify Ethereum [`eth_getProof`](https://eips.ethereum.org/EIPS/eip-1186)
responses against a trusted state root: account balance, nonce, code hash,
and storage slots, with no trust in the RPC that served them. Built on the
MerkleForge `MerklePatriciaTrie` and tested against real mainnet proofs.

Part of [MerkleForge for TypeScript](https://github.com/1888-Labs/MerkleForge-ts), a project by [1888 Labs](https://github.com/1888-Labs).

```sh
npm i @1888-labs/merkle-ethereum
```

```ts
import { mappingSlot, verifyEthGetProof } from '@1888-labs/merkle-ethereum'

// stateRoot must come from a source you trust (a light client, a block header you verified).
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const holder = '0x...'
const response = await rpc('eth_getProof', [WETH, ['0x' + Buffer.from(mappingSlot(holder, 3n)).toString('hex')], blockTag])

const { account, storage } = verifyEthGetProof(stateRoot, response)
account?.balance   // ETH held by the WETH contract, proven
storage[0].value   // holder's WETH balance (balanceOf is mapping slot 3), proven
```

- `verifyAccountProof` returns the account, or `null` when the proof shows it does not exist.
- `verifyStorageProof` returns the slot value as a `bigint` (`0n` for an empty slot).
- `verifyEthGetProof` checks both and that the response's own fields agree with the proofs.
- Everything throws `MerkleError` with code `InvalidProof` on a mismatch.

Pass `{ hasher: await createKeccak256Wasm() }` from `@1888-labs/merkle-hash-wasm`
to verify faster.

Licensed under MIT OR Apache-2.0.
