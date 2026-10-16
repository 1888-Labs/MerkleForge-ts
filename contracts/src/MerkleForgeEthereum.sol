// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {MerkleForgePatricia} from "./MerkleForgePatricia.sol";

/// @title MerkleForgeEthereum
/// @notice Verifies `eth_getProof` (EIP-1186) account and storage proofs on-chain against a
///         trusted state root, e.g. from a verified block header or an L2's L1 view.
library MerkleForgeEthereum {
    /// @notice Root of an empty trie, the storage root of an account with no storage.
    bytes32 internal constant EMPTY_TRIE_ROOT =
        0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421;

    struct Account {
        bool exists;
        uint256 nonce;
        uint256 balance;
        bytes32 storageRoot;
        bytes32 codeHash;
    }

    /// @notice Verifies `accountProof` for `account` under `stateRoot`.
    /// @return valid False when the proof does not match `stateRoot` or the account is malformed.
    /// @return result The account; `exists` is false when the proof shows it does not exist.
    function verifyAccount(bytes32 stateRoot, address account, bytes[] memory accountProof)
        internal
        pure
        returns (bool valid, Account memory result)
    {
        (bool ok, bytes memory rlp) = MerkleForgePatricia.proveValue(
            stateRoot, abi.encodePacked(keccak256(abi.encodePacked(account))), accountProof
        );
        if (!ok) return (false, result);
        if (rlp.length == 0) return (true, result);

        (bool okList, MerkleForgePatricia.Item memory list) = MerkleForgePatricia.readItem(rlp, 0);
        if (!okList || !list.isList || list.offset + list.length != rlp.length) {
            return (false, result);
        }
        uint256[4] memory fields;
        uint256 cursor = list.offset;
        for (uint256 i; i < 4; ++i) {
            (bool okField, MerkleForgePatricia.Item memory field) =
                MerkleForgePatricia.readItem(rlp, cursor);
            if (!okField || field.isList || field.length > 32) return (false, result);
            fields[i] = _uint(rlp, field);
            if (i >= 2 && field.length != 32) return (false, result);
            cursor = field.offset + field.length;
        }
        if (cursor != rlp.length) return (false, result);
        result = Account(true, fields[0], fields[1], bytes32(fields[2]), bytes32(fields[3]));
        valid = true;
    }

    /// @notice Verifies a storage proof for `slot` under an account's `storageRoot`.
    /// @return valid False when the proof does not match `storageRoot`.
    /// @return value The slot value, 0 when the slot is empty.
    function verifyStorage(bytes32 storageRoot, bytes32 slot, bytes[] memory storageProof)
        internal
        pure
        returns (bool valid, uint256 value)
    {
        if (storageProof.length == 0) return (storageRoot == EMPTY_TRIE_ROOT, 0);
        (bool ok, bytes memory rlp) = MerkleForgePatricia.proveValue(
            storageRoot, abi.encodePacked(keccak256(abi.encode(slot))), storageProof
        );
        if (!ok) return (false, 0);
        if (rlp.length == 0) return (true, 0);
        (bool okItem, MerkleForgePatricia.Item memory item) = MerkleForgePatricia.readItem(rlp, 0);
        if (!okItem || item.isList || item.length > 32 || item.offset + item.length != rlp.length) {
            return (false, 0);
        }
        if (item.length == 0 || uint8(rlp[item.offset]) == 0) return (false, 0);
        return (true, _uint(rlp, item));
    }

    function _uint(bytes memory data, MerkleForgePatricia.Item memory item)
        private
        pure
        returns (uint256 v)
    {
        for (uint256 i; i < item.length; ++i) {
            v = (v << 8) | uint8(data[item.offset + i]);
        }
    }
}
