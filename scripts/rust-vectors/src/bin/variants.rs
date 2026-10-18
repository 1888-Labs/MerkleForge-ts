use merkle_core::traits::{HashFunction, MerkleTree};
use merkle_core::types::{LeafIndex, ProofSide};
use merkle_variants::{MerklePatriciaTrie, SparseMerkleTree};
use merkleforge_hash::{Blake3, Keccak256, Sha256};

fn hex(b: &[u8]) -> String {
    let mut s = String::from("\"0x");
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s.push('"');
    s
}
fn opt(b: Option<&[u8]>) -> String {
    b.map_or_else(|| "null".to_string(), hex)
}
fn list(items: Vec<String>) -> String {
    format!("[{}]", items.join(","))
}
fn key(i: usize) -> [u8; 32] {
    Sha256::hash(format!("key-{i}").as_bytes())
}
fn adjacent(i: u8) -> [u8; 32] {
    let mut k = key(1000);
    k[31] = i;
    k
}
fn value(i: usize) -> Vec<u8> {
    format!("value-{i}").into_bytes()
}

fn sparse<H: HashFunction>() -> String {
    let mut t = SparseMerkleTree::<H>::new();
    let mut roots = Vec::new();
    let mut counts = Vec::new();
    let mut keys: Vec<[u8; 32]> = (0..20).map(key).collect();
    keys.extend((0..6).map(adjacent));
    for (i, k) in keys.iter().enumerate() {
        t.insert(*k, &value(i)).unwrap();
        roots.push(hex(t.root().unwrap().as_ref()));
        counts.push(t.stored_node_count().to_string());
    }
    let p = t.generate_membership_proof(key(3)).unwrap();
    let member = format!(
        "{{\"key\":{},\"leaf\":{},\"siblings\":{}}}",
        hex(&p.key),
        opt(p.leaf.as_ref().map(|d| d.as_ref())),
        list(p.siblings.iter().map(|s| opt(s.as_ref().map(|d| d.as_ref()))).collect())
    );
    let absent = Sha256::hash(b"absent");
    let np = t.generate_membership_proof(absent).unwrap();
    let non_member = format!(
        "{{\"key\":{},\"siblings\":{}}}",
        hex(&np.key),
        list(np.siblings.iter().map(|s| opt(s.as_ref().map(|d| d.as_ref()))).collect())
    );
    let full_root = hex(t.root().unwrap().as_ref());
    let full_count = t.stored_node_count();
    let unbatched = t.unbatched_node_count_estimate();
    let mut removals = Vec::new();
    for k in [key(0), key(5), adjacent(2), adjacent(3)] {
        t.remove(k).unwrap();
        removals.push(format!(
            "{{\"key\":{},\"root\":{},\"storedNodeCount\":{},\"lastNodeAccessCount\":{}}}",
            hex(&k),
            hex(t.root().unwrap().as_ref()),
            t.stored_node_count(),
            t.last_node_access_count()
        ));
    }
    let updates: Vec<([u8; 32], Vec<u8>)> = (20..30)
        .map(|i| (key(i), value(i)))
        .chain([(key(1), b"overwritten".to_vec()), (key(21), b"last-wins".to_vec())])
        .collect();
    t.batch_insert(&updates).unwrap();
    let batch_insert = format!(
        "{{\"root\":{},\"leafCount\":{},\"storedNodeCount\":{},\"lastNodeAccessCount\":{}}}",
        hex(t.root().unwrap().as_ref()),
        t.leaf_count(),
        t.stored_node_count(),
        t.last_node_access_count()
    );
    t.batch_remove(&[key(20), key(2), adjacent(0), key(20)]).unwrap();
    let batch_remove = format!(
        "{{\"root\":{},\"leafCount\":{},\"storedNodeCount\":{}}}",
        hex(t.root().unwrap().as_ref()),
        t.leaf_count(),
        t.stored_node_count()
    );

    let mut ix = SparseMerkleTree::<H>::new();
    for i in 0..5 {
        MerkleTree::insert(&mut ix, format!("leaf-{i}").as_bytes()).unwrap();
    }
    MerkleTree::remove(&mut ix, LeafIndex(2)).unwrap();
    let next = MerkleTree::insert(&mut ix, b"leaf-again").unwrap().value();
    let proof = MerkleTree::generate_proof(&ix, LeafIndex(1)).unwrap();
    let path: Vec<String> = proof
        .path
        .iter()
        .map(|n| {
            let side = if n.side == ProofSide::Left { "left" } else { "right" };
            format!("{{\"hash\":{},\"side\":\"{side}\"}}", hex(n.hash.as_ref()))
        })
        .collect();
    let indexed = format!(
        "{{\"root\":{},\"nextIndex\":{next},\"leafCount\":{},\"proof1\":{}}}",
        hex(MerkleTree::root(&ix).unwrap().as_ref()),
        MerkleTree::leaf_count(&ix),
        list(path)
    );

    format!(
        "{{\"emptyRoot\":{},\"insertRoots\":{},\"insertStoredNodeCounts\":[{}],\"root\":{full_root},\"storedNodeCount\":{full_count},\"unbatchedNodeCountEstimate\":{unbatched},\"membership\":{member},\"nonMembership\":{non_member},\"removals\":{},\"batchInsert\":{batch_insert},\"batchRemove\":{batch_remove},\"indexed\":{indexed}}}",
        hex(SparseMerkleTree::<H>::new().empty_root().as_ref()),
        list(roots),
        counts.join(","),
        list(removals)
    )
}

fn patricia<H: HashFunction>() -> String
where
    H::Digest: TryFrom<Vec<u8>>,
{
    let entries: Vec<(&[u8], Vec<u8>)> = vec![
        (b"do", b"verb".to_vec()),
        (b"dog", b"puppy".to_vec()),
        (b"doge", b"coin".to_vec()),
        (b"horse", b"stallion".to_vec()),
        (b"dogglesworth", b"a value long enough to force a hashed node reference here".to_vec()),
        (b"\x00\x01\x02", b"binary key".to_vec()),
    ];
    let mut t = MerklePatriciaTrie::<H>::new();
    let mut roots = Vec::new();
    for (k, v) in &entries {
        t.insert(k, v).unwrap();
        roots.push(hex(t.root().unwrap().as_ref()));
    }
    let proof_json = |p: &merkle_variants::MptProof<H::Digest>| {
        format!(
            "{{\"key\":{},\"value\":{},\"proofNodes\":{}}}",
            hex(&p.key),
            opt(p.value.as_deref()),
            list(p.proof_nodes.iter().map(|n| hex(n)).collect())
        )
    };
    let member = proof_json(&t.generate_proof(b"dog").unwrap());
    let long_member = proof_json(&t.generate_proof(b"dogglesworth").unwrap());
    let non_member = proof_json(&t.generate_proof(b"dot").unwrap());
    let full = format!(
        "{{\"root\":{},\"nodeCount\":{},\"height\":{}}}",
        hex(t.root().unwrap().as_ref()),
        t.node_count(),
        t.height()
    );
    let mut removals = Vec::new();
    for k in [&b"doge"[..], b"do", b"horse"] {
        t.remove(k).unwrap();
        removals.push(format!(
            "{{\"key\":{},\"root\":{},\"nodeCount\":{},\"height\":{}}}",
            hex(k),
            hex(t.root().unwrap().as_ref()),
            t.node_count(),
            t.height()
        ));
    }
    let mut ix = MerklePatriciaTrie::<H>::new();
    for i in 0..4 {
        MerkleTree::insert(&mut ix, format!("leaf-{i}").as_bytes()).unwrap();
    }
    MerkleTree::remove(&mut ix, LeafIndex(1)).unwrap();
    let next = MerkleTree::insert(&mut ix, b"leaf-again").unwrap().value();
    format!(
        "{{\"entries\":{},\"insertRoots\":{},\"full\":{full},\"membership\":{member},\"longMembership\":{long_member},\"nonMembership\":{non_member},\"removals\":{},\"indexed\":{{\"root\":{},\"nextIndex\":{next}}}}}",
        list(entries.iter().map(|(k, v)| format!("[{},{}]", hex(k), hex(v))).collect()),
        list(roots),
        list(removals),
        hex(MerkleTree::root(&ix).unwrap().as_ref())
    )
}

fn main() {
    let mut out = Vec::new();
    for (name, s, p) in [
        ("SHA-256", sparse::<Sha256>(), patricia::<Sha256>()),
        ("Keccak-256", sparse::<Keccak256>(), patricia::<Keccak256>()),
        ("BLAKE3", sparse::<Blake3>(), patricia::<Blake3>()),
    ] {
        out.push(format!("{{\"algorithm\":\"{name}\",\"sparse\":{s},\"patricia\":{p}}}"));
    }
    println!(
        "{{\"note\":\"Generated from the MerkleForge Rust crates (v0.5.0). Sparse keys: key(i) = Sha256.hash(utf8('key-' + i)); adjacent(i) = key(1000) with last byte i; values utf8('value-' + i).\",\"hashes\":{}}}",
        list(out)
    );
}
