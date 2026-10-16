# @1888-labs/merkle-hash

SHA-256, Keccak-256, and BLAKE3 adapters for MerkleForge, built on `@noble/hashes`.

Part of [MerkleForge for TypeScript](https://github.com/1888-Labs/MerkleForge-ts), a project by [1888 Labs](https://github.com/1888-Labs). Docs: <https://1888-labs.github.io/MerkleForge/>

```sh
npm i @1888-labs/merkle-hash
```

```ts
import { Blake3, Keccak256, Sha256 } from '@1888-labs/merkle-hash'
import { utf8 } from '@1888-labs/merkle-core'

Keccak256.hash(utf8('leaf')) // Keccak-256(0x00 || "leaf")
```

Licensed under MIT OR Apache-2.0.
