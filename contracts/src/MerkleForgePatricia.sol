// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

/// @title MerkleForgePatricia
/// @notice Verifies Merkle Patricia trie witnesses: Ethereum's state and storage tries, and
///         MerkleForge `MerklePatriciaTrie<Keccak256>` (Rust or TypeScript), which share the format.
/// @dev Nodes are RLP; a child is referenced by `keccak256(rlp)` or, when its RLP is under 32
///      bytes, embedded inline. Inline children may be listed in the witness (MerkleForge) or not
///      (`eth_getProof`); both are accepted. Functions return `valid = false` instead of reverting.
library MerkleForgePatricia {
    /// @notice A decoded RLP item: the payload is `data[offset:offset + length]`, and the whole
    ///         encoding (header included) starts at `start`.
    struct Item {
        uint256 start;
        uint256 offset;
        uint256 length;
        bool isList;
    }

    // Internally an item is packed into one word: start | offset << 64 | length << 128 | list << 192.
    uint256 private constant MASK = 0xffffffffffffffff;

    /// @dev Walk state, kept in memory so the walker compiles without via-IR.
    struct Cursor {
        bytes key;
        bytes[] proof;
        uint256 index;
        uint256 pos;
        bytes node;
    }

    uint256 private constant CONTINUE = 0;
    uint256 private constant DONE = 1;
    uint256 private constant INVALID = 2;

    /// @notice Walks `proof` (root first) for `key` and returns the value it proves.
    /// @return valid False when the witness does not connect to `root` or is malformed.
    /// @return value The stored value, or empty bytes when the witness proves `key` is absent.
    function proveValue(bytes32 root, bytes memory key, bytes[] memory proof)
        internal
        pure
        returns (bool valid, bytes memory value)
    {
        if (proof.length == 0 || keccak256(proof[0]) != root) return (false, "");
        Cursor memory c = Cursor(key, proof, 0, 0, proof[0]);
        while (true) {
            (uint256 status, uint256 next, bytes memory found) = _step(c);
            if (status == CONTINUE) status = _follow(c, next);
            if (status == INVALID) return (false, "");
            // A walk must end on the last listed node: extra nodes make the witness invalid.
            if (status == DONE) return (c.index + 1 == c.proof.length, found);
        }
    }

    /// @notice True when `proof` shows `key` holds `value` (pass empty `value` to prove absence).
    function verify(bytes32 root, bytes memory key, bytes memory value, bytes[] memory proof)
        internal
        pure
        returns (bool)
    {
        (bool valid, bytes memory proven) = proveValue(root, key, proof);
        return valid && keccak256(proven) == keccak256(value);
    }

    /// @notice Decodes the RLP item starting at `start` in `data`.
    function readItem(bytes memory data, uint256 start)
        internal
        pure
        returns (bool ok, Item memory item)
    {
        uint256 packed;
        (ok, packed) = _header(data, start);
        item = Item(
            packed & MASK, (packed >> 64) & MASK, (packed >> 128) & MASK, (packed >> 192) & 1 == 1
        );
    }

    // ── Walker ───────────────────────────────────────────────────────────────────────────────

    /// @dev Reads the current node. Returns the child item to follow, or the proven value.
    function _step(Cursor memory c)
        private
        pure
        returns (uint256 status, uint256 next, bytes memory found)
    {
        bytes memory node = c.node;
        if (node.length == 1 && uint8(node[0]) == 0x80) return (DONE, 0, "");
        (bool ok, uint256[] memory items) = _list(node);
        if (!ok) return (INVALID, 0, "");

        if (items.length == 17) {
            if (c.pos == c.key.length * 2) {
                if (_isList(items[16])) return (INVALID, 0, "");
                return (DONE, 0, _payload(node, items[16]));
            }
            next = items[_nibble(c.key, c.pos)];
            ++c.pos;
            return (CONTINUE, next, "");
        }

        uint256 path = items[0];
        if (_isList(path) || _length(path) == 0) return (INVALID, 0, "");
        (bool okPath, bool isLeaf, uint256 matched) = _matchPath(node, path, c.key, c.pos);
        if (!okPath) return (INVALID, 0, "");
        if (isLeaf) {
            if (_isList(items[1])) return (INVALID, 0, "");
            bool hit = matched != type(uint256).max && c.pos + matched == c.key.length * 2;
            return (DONE, 0, hit ? _payload(node, items[1]) : bytes(""));
        }
        if (matched == type(uint256).max) return (DONE, 0, "");
        c.pos += matched;
        return (CONTINUE, items[1], "");
    }

    /// @dev Moves the cursor to the child `next` refers to (hash, inline node, or empty slot).
    function _follow(Cursor memory c, uint256 next) private pure returns (uint256) {
        if (_isList(next)) {
            bytes memory embedded =
                _copy(c.node, next & MASK, _offset(next) + _length(next) - (next & MASK));
            if (embedded.length >= 32) return INVALID;
            if (
                c.index + 1 < c.proof.length
                    && keccak256(c.proof[c.index + 1]) == keccak256(embedded)
            ) {
                ++c.index;
            }
            c.node = embedded;
            return CONTINUE;
        }
        uint256 length = _length(next);
        if (length == 0) return DONE;
        if (length != 32) return INVALID;
        bytes memory node = c.node;
        uint256 offset = _offset(next);
        bytes32 hash;
        assembly ("memory-safe") {
            hash := mload(add(add(node, 0x20), offset))
        }
        ++c.index;
        if (c.index >= c.proof.length || keccak256(c.proof[c.index]) != hash) return INVALID;
        c.node = c.proof[c.index];
        return CONTINUE;
    }

    /// @dev Compares a hex-prefix path item with `key` from nibble `pos`. `matched` is the path
    ///      length in nibbles, or `type(uint256).max` when the path diverges from the key.
    function _matchPath(bytes memory node, uint256 path, bytes memory key, uint256 pos)
        private
        pure
        returns (bool ok, bool isLeaf, uint256 matched)
    {
        uint256 offset = _offset(path);
        uint256 first = _byteAt(node, offset);
        uint256 flag = first >> 4;
        if (flag > 3 || (flag & 1 == 0 && first & 0x0f != 0)) return (false, false, 0);
        isLeaf = flag >= 2;
        uint256 skip = 2 - (flag & 1);
        matched = _length(path) * 2 - skip;
        if (pos + matched > key.length * 2) return (true, isLeaf, type(uint256).max);
        for (uint256 i; i < matched; ++i) {
            uint256 at = i + skip;
            uint256 b = _byteAt(node, offset + (at >> 1));
            if (_nibble(key, pos + i) != (at & 1 == 0 ? b >> 4 : b & 0x0f)) {
                return (true, isLeaf, type(uint256).max);
            }
        }
        ok = true;
    }

    // ── RLP ──────────────────────────────────────────────────────────────────────────────────

    /// @dev Parses the RLP header at `start` into a packed item, checking it fits in `data`.
    function _header(bytes memory data, uint256 start)
        private
        pure
        returns (bool ok, uint256 packed)
    {
        assembly ("memory-safe") {
            // Parses the RLP header at `start`: returns ok and the packed item.
            function header(base_, size_, start_) -> ok_, packed_ {
                if lt(start_, size_) {
                    let prefix_ := byte(0, mload(add(base_, start_)))
                    let offset_ := add(start_, 1)
                    let length_ := 0
                    let list_ := 0
                    let lenOfLen_ := 0
                    switch lt(prefix_, 0x80)
                    case 1 {
                        offset_ := start_
                        length_ := 1
                    }
                    default {
                        switch lt(prefix_, 0xb8)
                        case 1 { length_ := sub(prefix_, 0x80) }
                        default {
                            switch lt(prefix_, 0xc0)
                            case 1 { lenOfLen_ := sub(prefix_, 0xb7) }
                            default {
                                list_ := 1
                                switch lt(prefix_, 0xf8)
                                case 1 { length_ := sub(prefix_, 0xc0) }
                                default { lenOfLen_ := sub(prefix_, 0xf7) }
                            }
                        }
                    }
                    ok_ := 1
                    if lenOfLen_ {
                        // At most 8 length_ bytes, all inside the data, with no leading zero.
                        if or(gt(lenOfLen_, 8), gt(add(add(start_, 1), lenOfLen_), size_)) {
                            ok_ := 0
                        }
                        if ok_ {
                            let raw_ := mload(add(base_, add(start_, 1)))
                            if iszero(byte(0, raw_)) { ok_ := 0 }
                            length_ := shr(mul(8, sub(32, lenOfLen_)), raw_)
                            offset_ := add(add(start_, 1), lenOfLen_)
                        }
                    }
                    if gt(add(offset_, length_), size_) { ok_ := 0 }
                    if ok_ {
                        packed_ := or(
                            or(start_, shl(64, offset_)),
                            or(shl(128, length_), shl(192, list_))
                        )
                    }
                }
            }
            ok, packed := header(add(data, 0x20), mload(data), start)
        }
    }

    /// @dev Decodes `data` as exactly one RLP list of 2 or 17 items.
    function _list(bytes memory data) private pure returns (bool ok, uint256[] memory items) {
        items = new uint256[](17);
        assembly ("memory-safe") {
            // Parses the RLP header at `start`: returns ok and the packed item.
            function header(base_, size_, start_) -> ok_, packed_ {
                if lt(start_, size_) {
                    let prefix_ := byte(0, mload(add(base_, start_)))
                    let offset_ := add(start_, 1)
                    let length_ := 0
                    let list_ := 0
                    let lenOfLen_ := 0
                    switch lt(prefix_, 0x80)
                    case 1 {
                        offset_ := start_
                        length_ := 1
                    }
                    default {
                        switch lt(prefix_, 0xb8)
                        case 1 { length_ := sub(prefix_, 0x80) }
                        default {
                            switch lt(prefix_, 0xc0)
                            case 1 { lenOfLen_ := sub(prefix_, 0xb7) }
                            default {
                                list_ := 1
                                switch lt(prefix_, 0xf8)
                                case 1 { length_ := sub(prefix_, 0xc0) }
                                default { lenOfLen_ := sub(prefix_, 0xf7) }
                            }
                        }
                    }
                    ok_ := 1
                    if lenOfLen_ {
                        // At most 8 length_ bytes, all inside the data, with no leading zero.
                        if or(gt(lenOfLen_, 8), gt(add(add(start_, 1), lenOfLen_), size_)) {
                            ok_ := 0
                        }
                        if ok_ {
                            let raw_ := mload(add(base_, add(start_, 1)))
                            if iszero(byte(0, raw_)) { ok_ := 0 }
                            length_ := shr(mul(8, sub(32, lenOfLen_)), raw_)
                            offset_ := add(add(start_, 1), lenOfLen_)
                        }
                    }
                    if gt(add(offset_, length_), size_) { ok_ := 0 }
                    if ok_ {
                        packed_ := or(
                            or(start_, shl(64, offset_)),
                            or(shl(128, length_), shl(192, list_))
                        )
                    }
                }
            }
            let base := add(data, 0x20)
            let size := mload(data)
            let good, list := header(base, size, 0)
            let mask := 0xffffffffffffffff
            // The list must be the whole node.
            if and(
                good,
                and(
                    shr(192, list),
                    eq(add(and(shr(64, list), mask), and(shr(128, list), mask)), size)
                )
            ) {
                let count := 0
                let cursor := and(shr(64, list), mask)
                for {} lt(cursor, size) {} {
                    if eq(count, 17) {
                        good := 0
                        break
                    }
                    let okItem, item := header(base, size, cursor)
                    if iszero(okItem) {
                        good := 0
                        break
                    }
                    mstore(add(add(items, 0x20), shl(5, count)), item)
                    count := add(count, 1)
                    cursor := add(and(shr(64, item), mask), and(shr(128, item), mask))
                }
                if and(good, or(eq(count, 2), eq(count, 17))) {
                    mstore(items, count)
                    ok := 1
                }
            }
        }
    }

    function _payload(bytes memory data, uint256 item) private pure returns (bytes memory) {
        return _copy(data, _offset(item), _length(item));
    }

    /// @dev Word-at-a-time copy of `data[from:from + length]`.
    function _copy(bytes memory data, uint256 from, uint256 length)
        private
        pure
        returns (bytes memory out)
    {
        out = new bytes(length);
        assembly ("memory-safe") {
            let src := add(add(data, 0x20), from)
            let dst := add(out, 0x20)
            for { let i := 0 } lt(i, length) { i := add(i, 0x20) } {
                mstore(add(dst, i), mload(add(src, i)))
            }
            // Clear any bytes copied past the end, so `out` is clean up to the next word.
            mstore(add(dst, length), 0)
        }
    }

    function _byteAt(bytes memory data, uint256 i) private pure returns (uint256 b) {
        assembly ("memory-safe") {
            b := byte(0, mload(add(add(data, 0x20), i)))
        }
    }

    function _nibble(bytes memory key, uint256 pos) private pure returns (uint256) {
        uint256 b = _byteAt(key, pos >> 1);
        return pos & 1 == 0 ? b >> 4 : b & 0x0f;
    }

    function _offset(uint256 item) private pure returns (uint256) {
        return (item >> 64) & MASK;
    }

    function _length(uint256 item) private pure returns (uint256) {
        return (item >> 128) & MASK;
    }

    function _isList(uint256 item) private pure returns (bool) {
        return (item >> 192) & 1 == 1;
    }
}
