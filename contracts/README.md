# MerkleForge Solidity verifiers

On-chain verifiers for proofs made by MerkleForge (Rust or TypeScript) with
Keccak-256, plus Ethereum `eth_getProof` verification. Every function returns
`false` for a malformed proof instead of reverting, and all of them compile
without via-IR.

| Library | Verifies | Gas (measured) |
|---------|----------|----------------|
| `MerkleForgeBinary` | `BinaryMerkleTree<Keccak256>` proofs and multiproofs | ~4.6k for a 100-leaf proof |
| `MerkleForgeSparse` | `SparseMerkleTree<Keccak256>` membership and non-membership | ~74k |
| `MerkleForgePatricia` | Merkle Patricia trie witnesses (MerkleForge tries and Ethereum) | per node, see below |
| `MerkleForgeEthereum` | `eth_getProof` accounts and storage slots against a state root | ~152k account, ~107k storage slot |

Gas is from `forge test --gas-report` (Solidity 0.8.28, optimizer on, 10,000 runs) for one
call through an external wrapper, using the fixtures in `test/fixtures/proofs.json`. The
Ethereum numbers use a real mainnet WETH proof (9 account nodes, 7 storage nodes).

## Shaping proofs in TypeScript

```ts
import { toSolidityBinaryProof, toSoliditySparseProof } from '@merkleforge/variants'

const { leafIndex, leafCount, siblings } = toSolidityBinaryProof(tree.generateProof(3))
const { key, siblings: sparseSiblings, bitmap } = toSoliditySparseProof(smt.generateMembershipProof(key))
```

`eth_getProof` responses can be passed straight through: `accountProof` and each
`storageProof[i].proof` are already `bytes[]`.

```solidity
import {MerkleForgeEthereum} from "merkleforge/MerkleForgeEthereum.sol";

(bool valid, MerkleForgeEthereum.Account memory account) =
    MerkleForgeEthereum.verifyAccount(stateRoot, target, accountProof);
require(valid && account.exists, "bad proof");
(bool ok, uint256 value) = MerkleForgeEthereum.verifyStorage(account.storageRoot, slot, storageProof);
```

`stateRoot` must come from a source you trust, such as a verified block header or
`blockhash` plus the header RLP.

## Notes

- Sparse proofs carry only non-empty siblings and a bitmap (bit `i` set = sibling at level `i`
  is present). Empty-subtree hashes are rebuilt in the loop; a shared 8 KB table contract was
  measured at only ~6% cheaper, so it is not included.
- The Patricia verifier accepts inline child nodes both listed in the witness (MerkleForge) and
  embedded in the parent (`eth_getProof`).
- Not audited. See the repository's SECURITY.md.

## Testing

```sh
pnpm fixtures:solidity   # regenerate test/fixtures from the TypeScript packages
pnpm test:solidity       # forge test (needs Foundry)
```

The tests need no forge-std; they declare the few cheatcodes they use. Fuzz tests check that
arbitrary or mutated witnesses never revert and never prove a different value.
