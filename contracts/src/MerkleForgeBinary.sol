// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

/// @title MerkleForgeBinary
/// @notice Verifies proofs from a MerkleForge `BinaryMerkleTree<Keccak256>` (Rust or TypeScript).
/// @dev Leaves are `keccak256(0x00 || data)` and internal nodes `keccak256(0x01 || left || right)`.
///      Trees are padded to a power of two with `keccak256(0x00)`. Every function returns `false`
///      for a malformed proof instead of reverting.
library MerkleForgeBinary {
    /// @notice `keccak256(0x00 || data)`, the MerkleForge leaf hash.
    function hashLeaf(bytes memory data) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes1(0x00), data));
    }

    /// @notice `keccak256(0x01 || left || right)`, the MerkleForge internal-node hash.
    function hashNodes(bytes32 left, bytes32 right) internal pure returns (bytes32 parent) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore8(ptr, 0x01)
            mstore(add(ptr, 1), left)
            mstore(add(ptr, 33), right)
            parent := keccak256(ptr, 65)
        }
    }

    /// @notice Number of siblings in a proof for a tree of `leafCount` leaves.
    function depth(uint256 leafCount) internal pure returns (uint256 d) {
        while ((uint256(1) << d) < leafCount) ++d;
    }

    /// @notice Checks that `leafData` is leaf `leafIndex` of a `leafCount`-leaf tree with `root`.
    function verify(
        bytes32 root,
        bytes memory leafData,
        uint256 leafIndex,
        uint256 leafCount,
        bytes32[] memory siblings
    ) internal pure returns (bool) {
        if (leafData.length == 0) return false;
        return verifyLeafHash(root, hashLeaf(leafData), leafIndex, leafCount, siblings);
    }

    /// @notice Like `verify`, for callers that already hold the leaf hash.
    function verifyLeafHash(
        bytes32 root,
        bytes32 leafHash,
        uint256 leafIndex,
        uint256 leafCount,
        bytes32[] memory siblings
    ) internal pure returns (bool) {
        if (leafCount == 0 || leafIndex >= leafCount || siblings.length != depth(leafCount)) {
            return false;
        }
        bytes32 current = leafHash;
        for (uint256 i; i < siblings.length; ++i) {
            current = leafIndex & 1 == 0
                ? hashNodes(current, siblings[i])
                : hashNodes(siblings[i], current);
            leafIndex >>= 1;
        }
        return current == root;
    }

    /// @notice Checks a MerkleForge binary multiproof for `leaves` at strictly increasing `leafIndices`.
    function verifyMultiProof(
        bytes32 root,
        bytes[] memory leaves,
        uint256[] memory leafIndices,
        uint256 leafCount,
        bytes32[] memory hashes
    ) internal pure returns (bool) {
        uint256 n = leafIndices.length;
        if (n == 0 || n != leaves.length || leafCount == 0) return false;

        uint256[] memory offsets = new uint256[](n);
        bytes32[] memory nodes = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            uint256 index = leafIndices[i];
            if (index >= leafCount || (i > 0 && index <= leafIndices[i - 1])) return false;
            if (leaves[i].length == 0) return false;
            offsets[i] = index;
            nodes[i] = hashLeaf(leaves[i]);
        }

        uint256 used;
        for (uint256 width = uint256(1) << depth(leafCount); width > 1; width >>= 1) {
            uint256 m;
            for (uint256 i; i < n; ++i) {
                uint256 offset = offsets[i];
                bytes32 parent;
                if (offset & 1 == 0 && i + 1 < n && offsets[i + 1] == offset + 1) {
                    parent = hashNodes(nodes[i], nodes[i + 1]);
                    ++i;
                } else {
                    if (used >= hashes.length) return false;
                    bytes32 sibling = hashes[used++];
                    parent = offset & 1 == 0
                        ? hashNodes(nodes[i], sibling)
                        : hashNodes(sibling, nodes[i]);
                }
                offsets[m] = offset >> 1;
                nodes[m] = parent;
                ++m;
            }
            n = m;
        }
        return used == hashes.length && n == 1 && nodes[0] == root;
    }
}
