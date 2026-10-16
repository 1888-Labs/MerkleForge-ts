# @1888-labs/merkle-core

Interfaces, proof types, errors, and byte helpers shared by every MerkleForge package. No tree logic.

Part of [MerkleForge for TypeScript](https://github.com/1888-Labs/MerkleForge-ts), a project by [1888 Labs](https://github.com/1888-Labs). Docs: <https://1888-labs.github.io/MerkleForge/>

```sh
npm i @1888-labs/merkle-core
```

```ts
import { defineHashFunction } from '@1888-labs/merkle-core'

// Bring your own hash: only `hash` is required. `hashNodes` defaults to hash(0x01 || left || right).
const MyHash = defineHashFunction({ algorithmName: 'MyHash', digestSize: 32, hash: myHashFn })
```

Licensed under MIT OR Apache-2.0.
