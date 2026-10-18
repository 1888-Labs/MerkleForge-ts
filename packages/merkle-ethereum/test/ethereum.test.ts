import { fromHex, isMerkleError, toHex, utf8 } from '@merkleforge/core'
import { createKeccak256Wasm } from '@merkleforge/hash-wasm'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_TRIE_ROOT,
  type EthGetProofResponse,
  keccak256,
  mappingSlot,
  toBytes32,
  verifyAccountProof,
  verifyEthGetProof,
  verifyStorageProof,
} from '../src/index.js'
import fixture from './fixtures/mainnet-proofs.json' with { type: 'json' }

const { stateRoot } = fixture
const contract = fixture.contract as EthGetProofResponse
const eoa = fixture.eoa as EthGetProofResponse
const missing = fixture.missing as EthGetProofResponse
const clone = (r: EthGetProofResponse): EthGetProofResponse => JSON.parse(JSON.stringify(r))

describe(`eth_getProof on mainnet block ${fixture.blockNumber}`, () => {
  it('verifies the WETH contract account and its storage', () => {
    const verified = verifyEthGetProof(stateRoot, contract)
    expect(verified.account?.balance).toBe(BigInt(contract.balance))
    expect(verified.account?.nonce).toBe(1n)
    const [name, symbol, decimals, empty] = verified.storage.map((s) => s.value)
    // Short Solidity strings store the bytes left-aligned with length * 2 in the last byte.
    expect(toHex(toBytes32(name ?? 0n)).slice(0, 2 + 13 * 2)).toBe(toHex(utf8('Wrapped Ether')))
    expect(toHex(toBytes32(symbol ?? 0n)).slice(0, 2 + 4 * 2)).toBe(toHex(utf8('WETH')))
    expect(decimals).toBe(18n)
    expect(empty).toBe(0n)
  })

  it('verifies an account with no storage', () => {
    const verified = verifyEthGetProof(stateRoot, eoa)
    expect(verified.account?.storageRoot).toEqual(EMPTY_TRIE_ROOT)
    expect(verified.account?.nonce).toBe(BigInt(eoa.nonce))
  })

  it('proves that an account does not exist', () => {
    expect(
      verifyAccountProof({ stateRoot, address: missing.address, proof: missing.accountProof }),
    ).toBeNull()
    expect(verifyEthGetProof(stateRoot, missing).account).toBeNull()
  })

  it('works with the WASM Keccak adapter', async () => {
    const hasher = await createKeccak256Wasm()
    expect(verifyEthGetProof(stateRoot, contract, { hasher }).storage[2]?.value).toBe(18n)
  })

  it('rejects responses that do not match the proofs', () => {
    const mutations: ((r: EthGetProofResponse) => void)[] = [
      (r) => {
        r.balance = '0x1'
      },
      (r) => {
        r.nonce = '0x2'
      },
      (r) => {
        r.codeHash = toHex(new Uint8Array(32))
      },
      (r) => {
        r.storageProof[2] = {
          ...(r.storageProof[2] as EthGetProofResponse['storageProof'][number]),
          value: '0x13',
        }
      },
      (r) => {
        r.accountProof = r.accountProof.slice(0, -1)
      },
      (r) => {
        r.accountProof = [...r.accountProof, '0x80']
      },
      (r) => {
        r.address = eoa.address
      },
    ]
    for (const mutate of mutations) {
      const r = clone(contract)
      mutate(r)
      expect(() => verifyEthGetProof(stateRoot, r)).toThrow(
        expect.objectContaining({ code: 'InvalidProof' }),
      )
    }
    expect(() => verifyEthGetProof(toHex(new Uint8Array(32)), contract)).toThrow(
      /verification failed/,
    )
    const fakeMissing = clone(missing)
    fakeMissing.balance = '0x5'
    expect(() => verifyEthGetProof(stateRoot, fakeMissing)).toThrow(
      expect.objectContaining({ code: 'InvalidProof' }),
    )
  })

  it('rejects a storage proof against the wrong root', () => {
    const slot = contract.storageProof[0] as EthGetProofResponse['storageProof'][number]
    try {
      verifyStorageProof({ storageRoot: eoa.storageHash, slot: slot.key, proof: slot.proof })
      expect.unreachable()
    } catch (error) {
      expect(isMerkleError(error, 'InvalidProof')).toBe(true)
    }
  })
})

describe('helpers', () => {
  it('computes raw keccak and Solidity mapping slots', () => {
    expect(toHex(keccak256(new Uint8Array()))).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    )
    const holder = fromHex('0x00000000000000000000000000000000000000aa')
    expect(mappingSlot(holder, 3n)).toEqual(
      keccak256(new Uint8Array([...toBytes32(holder), ...toBytes32(3n)])),
    )
    expect(() => toBytes32(new Uint8Array(33))).toThrow(RangeError)
  })
})
