// SPDX-License-Identifier: MIT OR Apache-2.0
pragma solidity ^0.8.24;

import {MerkleForgePatricia} from "../src/MerkleForgePatricia.sol";
import {MerkleForgeEthereum} from "../src/MerkleForgeEthereum.sol";
import {Vm} from "./MerkleForge.t.sol";
import {MerkleForgeVerifier} from "./Gas.t.sol";

/// Checks the Patricia and eth_getProof verifiers against MerkleForge tries and real mainnet proofs.
contract PatriciaTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    string private json;

    function setUp() public {
        json = vm.readFile("test/fixtures/proofs.json");
    }

    function _key(string memory path, string memory field) private pure returns (string memory) {
        return string.concat(path, ".", field);
    }

    function _mpt(uint256 i, string memory field) private pure returns (string memory) {
        return string.concat(".mpt[", vm.toString(i), "].", field);
    }

    function _tamper(bytes[] memory proof, uint256 at) private pure returns (bytes[] memory out) {
        out = new bytes[](proof.length);
        for (uint256 i; i < proof.length; ++i) {
            out[i] = proof[i];
        }
        bytes memory copy = bytes.concat(out[at]);
        copy[copy.length - 1] ^= 0x01;
        out[at] = copy;
    }

    function testMerkleForgeTrieWitnesses() public view {
        uint256 count = vm.parseJsonUint(json, ".mptCount");
        for (uint256 i; i < count; ++i) {
            bytes32 root = vm.parseJsonBytes32(json, _mpt(i, "root"));
            bytes memory key = vm.parseJsonBytes(json, _mpt(i, "key"));
            bytes memory value = vm.parseJsonBytes(json, _mpt(i, "value"));
            bytes[] memory proof = vm.parseJsonBytesArray(json, _mpt(i, "proof"));

            (bool valid, bytes memory proven) = MerkleForgePatricia.proveValue(root, key, proof);
            require(valid, "valid witness rejected");
            require(keccak256(proven) == keccak256(value), "wrong value");
            require(MerkleForgePatricia.verify(root, key, value, proof), "verify");
            require(
                !MerkleForgePatricia.verify(root, key, bytes.concat(value, "x"), proof),
                "forged value"
            );
            for (uint256 at; at < proof.length; ++at) {
                (bool ok,) = MerkleForgePatricia.proveValue(root, key, _tamper(proof, at));
                require(!ok, "tampered node accepted");
            }
            (bool okRoot,) = MerkleForgePatricia.proveValue(bytes32(uint256(root) ^ 1), key, proof);
            require(!okRoot, "wrong root");
        }
    }

    function testMainnetAccounts() public view {
        bytes32 stateRoot = vm.parseJsonBytes32(json, ".eth.stateRoot");
        string[3] memory names = [".eth.contract", ".eth.eoa", ".eth.missing"];
        for (uint256 n; n < 3; ++n) {
            string memory a = names[n];
            address account = address(bytes20(vm.parseJsonBytes(json, _key(a, "address"))));
            bytes[] memory proof = vm.parseJsonBytesArray(json, _key(a, "accountProof"));

            (bool valid, MerkleForgeEthereum.Account memory acct) =
                MerkleForgeEthereum.verifyAccount(stateRoot, account, proof);
            require(valid, "account proof rejected");
            require(acct.exists == (n != 2), "existence");
            require(
                acct.balance == uint256(vm.parseJsonBytes32(json, _key(a, "balance"))), "balance"
            );
            require(acct.nonce == uint256(vm.parseJsonBytes32(json, _key(a, "nonce"))), "nonce");
            if (acct.exists) {
                require(
                    acct.storageRoot == vm.parseJsonBytes32(json, _key(a, "storageHash")),
                    "storage root"
                );
                require(
                    acct.codeHash == vm.parseJsonBytes32(json, _key(a, "codeHash")), "code hash"
                );
            }
            (bool wrong,) =
                MerkleForgeEthereum.verifyAccount(stateRoot, address(uint160(account) ^ 1), proof);
            require(!wrong || n == 2, "proof reused for another address");
            (bool tampered,) = MerkleForgeEthereum.verifyAccount(
                stateRoot, account, _tamper(proof, proof.length - 1)
            );
            require(!tampered, "tampered account proof");
        }
    }

    function testMainnetStorage() public view {
        bytes32 storageRoot = vm.parseJsonBytes32(json, ".eth.contract.storageHash");
        uint256 count = vm.parseJsonUint(json, ".eth.contract.storageCount");
        for (uint256 i; i < count; ++i) {
            string memory s = string.concat(".eth.contract.storage[", vm.toString(i), "]");
            bytes32 slot = vm.parseJsonBytes32(json, _key(s, "slot"));
            uint256 expected = uint256(vm.parseJsonBytes32(json, _key(s, "value")));
            bytes[] memory proof = vm.parseJsonBytesArray(json, _key(s, "proof"));

            (bool valid, uint256 value) =
                MerkleForgeEthereum.verifyStorage(storageRoot, slot, proof);
            require(valid && value == expected, "storage value");
            (bool tampered,) = MerkleForgeEthereum.verifyStorage(
                storageRoot, slot, _tamper(proof, proof.length - 1)
            );
            require(!tampered, "tampered storage proof");
        }
        // WETH decimals (slot 2) is 18.
        (, uint256 decimals) = MerkleForgeEthereum.verifyStorage(
            storageRoot,
            bytes32(uint256(2)),
            vm.parseJsonBytesArray(json, ".eth.contract.storage[2].proof")
        );
        require(decimals == 18, "decimals");
        (bool emptyOk, uint256 zero) = MerkleForgeEthereum.verifyStorage(
            MerkleForgeEthereum.EMPTY_TRIE_ROOT, slot0(), new bytes[](0)
        );
        require(emptyOk && zero == 0, "empty storage");
        (bool notEmpty,) = MerkleForgeEthereum.verifyStorage(storageRoot, slot0(), new bytes[](0));
        require(!notEmpty, "empty proof for non-empty root");
    }

    /// Calls through `MerkleForgeVerifier` so `forge test --gas-report` prices eth_getProof checks.
    function testGasReportEthereum() public {
        MerkleForgeVerifier verifier = new MerkleForgeVerifier();
        (bool okAccount,) = verifier.verifyAccount(
            vm.parseJsonBytes32(json, ".eth.stateRoot"),
            address(bytes20(vm.parseJsonBytes(json, ".eth.contract.address"))),
            vm.parseJsonBytesArray(json, ".eth.contract.accountProof")
        );
        (bool okStorage,) = verifier.verifyStorage(
            vm.parseJsonBytes32(json, ".eth.contract.storageHash"),
            bytes32(uint256(2)),
            vm.parseJsonBytesArray(json, ".eth.contract.storage[2].proof")
        );
        require(okAccount && okStorage, "gas report proofs");
    }

    function slot0() private pure returns (bytes32) {
        return bytes32(0);
    }

    function testMalformedInputNeverReverts() public pure {
        bytes[] memory proof = new bytes[](1);
        bytes[5] memory junk = [bytes(hex""), hex"ff", hex"c1", hex"f9ffff", hex"c3828080"];
        for (uint256 i; i < junk.length; ++i) {
            proof[0] = junk[i];
            (bool ok,) = MerkleForgePatricia.proveValue(keccak256(junk[i]), hex"00", proof);
            require(!ok, "junk accepted");
        }
        (bool none,) = MerkleForgePatricia.proveValue(bytes32(0), hex"00", new bytes[](0));
        require(!none, "empty proof");
    }

    /// Arbitrary bytes must never make the verifier revert (only return invalid).
    function testFuzzNeverReverts(bytes memory node, bytes memory child, bytes memory key)
        public
        pure
    {
        bytes[] memory proof = new bytes[](2);
        proof[0] = node;
        proof[1] = child;
        MerkleForgePatricia.proveValue(keccak256(node), key, proof);
        bytes[] memory single = new bytes[](1);
        single[0] = node;
        MerkleForgePatricia.proveValue(keccak256(node), key, single);
    }

    /// Mutating any byte of a real witness must never revert, and must not prove a different value.
    function testFuzzMutatedWitness(uint256 which, uint256 at, uint8 xor) public view {
        uint256 i = which % vm.parseJsonUint(json, ".mptCount");
        bytes32 root = vm.parseJsonBytes32(json, _mpt(i, "root"));
        bytes memory key = vm.parseJsonBytes(json, _mpt(i, "key"));
        bytes memory value = vm.parseJsonBytes(json, _mpt(i, "value"));
        bytes[] memory proof = vm.parseJsonBytesArray(json, _mpt(i, "proof"));
        uint256 node = at % proof.length;
        bytes memory copy = bytes.concat(proof[node]);
        copy[(at / proof.length) % copy.length] ^= bytes1(xor == 0 ? 1 : xor);
        proof[node] = copy;
        (bool ok, bytes memory proven) = MerkleForgePatricia.proveValue(root, key, proof);
        require(!ok || keccak256(proven) == keccak256(value), "mutation proved another value");
    }
}
