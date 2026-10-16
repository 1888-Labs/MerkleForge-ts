// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {MerkleForgeBinary} from "./MerkleForgeBinary.sol";

/// @title MerkleForgeSparse
/// @notice Verifies proofs from a MerkleForge `SparseMerkleTree<Keccak256>` (256-bit keys).
/// @dev Proofs carry only non-empty siblings plus a bitmap: bit `i` set means the sibling at
///      level `i` (0 = next to the leaf) is in `siblings`; unset levels are empty subtrees,
///      rebuilt here from the empty leaf `keccak256(0x00)`. Returns `false` instead of reverting.
library MerkleForgeSparse {
    /// @notice `keccak256(0x00)`: the empty leaf.
    bytes32 internal constant EMPTY_LEAF =
        0xbc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a;

    /// @notice Checks that `key` holds `leafData` in the tree with `root`.
    function verifyMembership(
        bytes32 root,
        bytes32 key,
        bytes memory leafData,
        bytes32[] memory siblings,
        uint256 bitmap
    ) internal pure returns (bool) {
        if (leafData.length == 0) return false;
        return computeRoot(key, MerkleForgeBinary.hashLeaf(leafData), siblings, bitmap) == root
            && _uses(siblings, bitmap);
    }

    /// @notice Checks that `key` is empty in the tree with `root`.
    function verifyNonMembership(
        bytes32 root,
        bytes32 key,
        bytes32[] memory siblings,
        uint256 bitmap
    ) internal pure returns (bool) {
        return computeRoot(key, EMPTY_LEAF, siblings, bitmap) == root && _uses(siblings, bitmap);
    }

    /// @notice Recomputes the root from a leaf hash. Missing siblings count as empty.
    /// @dev One assembly loop over the 256 levels, reusing a single 65-byte buffer for both the
    ///      path hash and the next empty-subtree hash.
    function computeRoot(bytes32 key, bytes32 leafHash, bytes32[] memory siblings, uint256 bitmap)
        internal
        pure
        returns (bytes32 current)
    {
        bytes32 empty = EMPTY_LEAF;
        assembly ("memory-safe") {
            let buf := mload(0x40)
            mstore8(buf, 0x01)
            let lo := add(buf, 1)
            let hi := add(buf, 33)
            let count := mload(siblings)
            let data := add(siblings, 0x20)
            let used := 0
            current := leafHash
            for { let level := 0 } lt(level, 256) { level := add(level, 1) } {
                let sibling := empty
                if and(shr(level, bitmap), 1) {
                    // A bitmap naming more levels than there are siblings is rejected by `_uses`.
                    if lt(used, count) { sibling := mload(add(data, shl(5, used))) }
                    used := add(used, 1)
                }
                switch and(shr(level, key), 1)
                case 1 {
                    mstore(lo, sibling)
                    mstore(hi, current)
                }
                default {
                    mstore(lo, current)
                    mstore(hi, sibling)
                }
                current := keccak256(buf, 65)
                mstore(lo, empty)
                mstore(hi, empty)
                empty := keccak256(buf, 65)
            }
        }
    }

    /// @dev The proof is well formed only when the bitmap names exactly `siblings.length` levels.
    function _uses(bytes32[] memory siblings, uint256 bitmap) private pure returns (bool) {
        uint256 count;
        for (; bitmap != 0; bitmap &= bitmap - 1) {
            ++count;
        }
        return count == siblings.length;
    }
}
