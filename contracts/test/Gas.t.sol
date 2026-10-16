// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {MerkleForgeBinary} from "../src/MerkleForgeBinary.sol";
import {MerkleForgeSparse} from "../src/MerkleForgeSparse.sol";
import {MerkleForgeEthereum} from "../src/MerkleForgeEthereum.sol";

/// External wrappers so `forge test --gas-report` shows per-call verification cost.
contract MerkleForgeVerifier {
    function verifyBinary(
        bytes32 root,
        bytes calldata leaf,
        uint256 index,
        uint256 count,
        bytes32[] calldata siblings
    ) external pure returns (bool) {
        return MerkleForgeBinary.verify(root, leaf, index, count, siblings);
    }

    function verifySparse(
        bytes32 root,
        bytes32 key,
        bytes calldata leaf,
        bytes32[] calldata siblings,
        uint256 bitmap
    ) external pure returns (bool) {
        return MerkleForgeSparse.verifyMembership(root, key, leaf, siblings, bitmap);
    }

    function verifyAccount(bytes32 stateRoot, address account, bytes[] calldata proof)
        external
        pure
        returns (bool valid, uint256 balance)
    {
        MerkleForgeEthereum.Account memory a;
        (valid, a) = MerkleForgeEthereum.verifyAccount(stateRoot, account, proof);
        balance = a.balance;
    }

    function verifyStorage(bytes32 storageRoot, bytes32 slot, bytes[] calldata proof)
        external
        pure
        returns (bool valid, uint256 value)
    {
        return MerkleForgeEthereum.verifyStorage(storageRoot, slot, proof);
    }
}
