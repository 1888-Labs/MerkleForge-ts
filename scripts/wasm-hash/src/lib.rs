//! Keccak-256 and SHA-256 for `@merkleforge/hash-wasm`, compiled to a small
//! `no_std` WebAssembly module with no imports.
//!
//! JavaScript owns all memory above `__heap_base` (exported): it grows the
//! memory as needed, copies inputs in, calls a batch function with byte
//! addresses, and reads the digests back. Batching is what makes this fast:
//! hashing a whole tree layer is one call instead of one per node. The module
//! has no imports, no allocator, and no global state.
//!
//! `prefix` is a domain separation byte hashed before the data, or -1 for none.
#![no_std]

mod keccak;
mod sha256;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// Shared shape of the batch functions, generic over the hash.
trait Hash {
    fn digest(prefix: i32, parts: &[&[u8]], out: &mut [u8; 32]);

    /// Two independent digests. Hashes with a SIMD path override this.
    fn digest2(prefix: i32, a: &[u8], b: &[u8], out_a: &mut [u8; 32], out_b: &mut [u8; 32]) {
        Self::digest(prefix, &[a], out_a);
        Self::digest(prefix, &[b], out_b);
    }
}

/// # Safety
/// `ptr..ptr + len` must be inside linear memory (out-of-bounds traps in wasm).
unsafe fn bytes<'a>(ptr: usize, len: usize) -> &'a [u8] {
    unsafe { core::slice::from_raw_parts(ptr as *const u8, len) }
}

/// # Safety
/// `ptr..ptr + 32` must be inside linear memory.
unsafe fn write(ptr: usize, digest: &[u8; 32]) {
    unsafe { core::ptr::copy_nonoverlapping(digest.as_ptr(), ptr as *mut u8, 32) }
}

/// Hashes `count` messages laid out back to back from `input`, with their
/// lengths as little-endian u32s at `lens`, into consecutive 32-byte digests at `out`.
unsafe fn many<H: Hash>(prefix: i32, input: usize, lens: usize, count: usize, out: usize) {
    let len = |i: usize| unsafe {
        u32::from_le_bytes(bytes(lens + 4 * i, 4).try_into().unwrap()) as usize
    };
    let mut offset = input;
    let mut i = 0;
    while i + 1 < count {
        let (len_a, len_b) = (len(i), len(i + 1));
        let (a, b) = unsafe { (bytes(offset, len_a), bytes(offset + len_a, len_b)) };
        let (mut digest_a, mut digest_b) = ([0u8; 32], [0u8; 32]);
        H::digest2(prefix, a, b, &mut digest_a, &mut digest_b);
        unsafe {
            write(out + 32 * i, &digest_a);
            write(out + 32 * i + 32, &digest_b);
        }
        offset += len_a + len_b;
        i += 2;
    }
    if i < count {
        let mut digest = [0u8; 32];
        H::digest(prefix, &[unsafe { bytes(offset, len(i)) }], &mut digest);
        unsafe { write(out + 32 * i, &digest) };
    }
}

/// Hashes `count` pairs of 32-byte nodes (`left || right`, 64 bytes per pair)
/// from `input` into `count` digests at `out`. `out` may equal `input`: pairs
/// `i` and `i + 1` are read before digests `i` and `i + 1` are written, and
/// those never overlap a later pair.
unsafe fn pairs<H: Hash>(prefix: i32, input: usize, count: usize, out: usize) {
    let mut i = 0;
    while i + 1 < count {
        let (mut digest_a, mut digest_b) = ([0u8; 32], [0u8; 32]);
        let (a, b) = unsafe { (bytes(input + 64 * i, 64), bytes(input + 64 * i + 64, 64)) };
        H::digest2(prefix, a, b, &mut digest_a, &mut digest_b);
        unsafe {
            write(out + 32 * i, &digest_a);
            write(out + 32 * i + 32, &digest_b);
        }
        i += 2;
    }
    if i < count {
        let mut digest = [0u8; 32];
        H::digest(prefix, &[unsafe { bytes(input + 64 * i, 64) }], &mut digest);
        unsafe { write(out + 32 * i, &digest) };
    }
}

macro_rules! exports {
    ($hash:ty, $many:ident, $pairs:ident) => {
        /// # Safety
        /// Every address range must be inside linear memory.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $many(
            prefix: i32,
            input: usize,
            lens: usize,
            count: usize,
            out: usize,
        ) {
            unsafe { many::<$hash>(prefix, input, lens, count, out) }
        }
        /// # Safety
        /// Every address range must be inside linear memory.
        #[unsafe(no_mangle)]
        pub unsafe extern "C" fn $pairs(prefix: i32, input: usize, count: usize, out: usize) {
            unsafe { pairs::<$hash>(prefix, input, count, out) }
        }
    };
}

exports!(keccak::Keccak256, keccak_many, keccak_pairs);
exports!(sha256::Sha256, sha256_many, sha256_pairs);
