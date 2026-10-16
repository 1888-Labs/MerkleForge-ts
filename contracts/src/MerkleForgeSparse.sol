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
    function computeRoot(bytes32 key, bytes32 leafHash, bytes32[] memory siblings, uint256 bitmap)
        internal
        pure
        returns (bytes32 current)
    {
        current = leafHash;
        bytes32 empty = EMPTY_LEAF;
        uint256 used;
        for (uint256 level; level < 256; ++level) {
            bytes32 sibling = empty;
            if ((bitmap >> level) & 1 == 1) {
                sibling = used < siblings.length ? siblings[used] : bytes32(0);
                ++used;
            }
            current = (uint256(key) >> level) & 1 == 1
                ? MerkleForgeBinary.hashNodes(sibling, current)
                : MerkleForgeBinary.hashNodes(current, sibling);
            empty = MerkleForgeBinary.hashNodes(empty, empty);
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
