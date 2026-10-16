// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {MerkleForgeBinary} from "../src/MerkleForgeBinary.sol";
import {MerkleForgeSparse} from "../src/MerkleForgeSparse.sol";

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
}
