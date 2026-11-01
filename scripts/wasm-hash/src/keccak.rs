//! Keccak-256 (the original padding Ethereum uses, not NIST SHA3-256).

const RATE: usize = 136;

const RC: [u64; 24] = [
    0x0000000000000001,
    0x0000000000008082,
    0x800000000000808a,
    0x8000000080008000,
    0x000000000000808b,
    0x0000000080000001,
    0x8000000080008081,
    0x8000000000008009,
    0x000000000000008a,
    0x0000000000000088,
    0x0000000080008009,
    0x000000008000000a,
    0x000000008000808b,
    0x800000000000008b,
    0x8000000000008089,
    0x8000000000008003,
    0x8000000000008002,
    0x8000000000000080,
    0x000000000000800a,
    0x800000008000000a,
    0x8000000080008081,
    0x8000000000008080,
    0x0000000080000001,
    0x8000000080008008,
];

/// Keccak-f[1600] with every lane in a local, so the whole state stays in
/// WebAssembly locals (and machine registers) instead of linear memory.
/// Lane (x, y) is `a[x + 5y]`; `b` holds the lanes after rho and pi.
#[inline(always)]
#[rustfmt::skip]
fn keccak_f(s: &mut [u64; 25]) {
    let [mut a0, mut a1, mut a2, mut a3, mut a4, mut a5, mut a6, mut a7, mut a8, mut a9, mut a10, mut a11, mut a12, mut a13, mut a14, mut a15, mut a16, mut a17, mut a18, mut a19, mut a20, mut a21, mut a22, mut a23, mut a24] = *s;
    for rc in RC {
        let c0 = a0 ^ a5 ^ a10 ^ a15 ^ a20;
        let c1 = a1 ^ a6 ^ a11 ^ a16 ^ a21;
        let c2 = a2 ^ a7 ^ a12 ^ a17 ^ a22;
        let c3 = a3 ^ a8 ^ a13 ^ a18 ^ a23;
        let c4 = a4 ^ a9 ^ a14 ^ a19 ^ a24;
        let d0 = c4 ^ c1.rotate_left(1);
        let d1 = c0 ^ c2.rotate_left(1);
        let d2 = c1 ^ c3.rotate_left(1);
        let d3 = c2 ^ c4.rotate_left(1);
        let d4 = c3 ^ c0.rotate_left(1);
        let b0 = (a0 ^ d0).rotate_left(0);
        let b16 = (a5 ^ d0).rotate_left(36);
        let b7 = (a10 ^ d0).rotate_left(3);
        let b23 = (a15 ^ d0).rotate_left(41);
        let b14 = (a20 ^ d0).rotate_left(18);
        let b10 = (a1 ^ d1).rotate_left(1);
        let b1 = (a6 ^ d1).rotate_left(44);
        let b17 = (a11 ^ d1).rotate_left(10);
        let b8 = (a16 ^ d1).rotate_left(45);
        let b24 = (a21 ^ d1).rotate_left(2);
        let b20 = (a2 ^ d2).rotate_left(62);
        let b11 = (a7 ^ d2).rotate_left(6);
        let b2 = (a12 ^ d2).rotate_left(43);
        let b18 = (a17 ^ d2).rotate_left(15);
        let b9 = (a22 ^ d2).rotate_left(61);
        let b5 = (a3 ^ d3).rotate_left(28);
        let b21 = (a8 ^ d3).rotate_left(55);
        let b12 = (a13 ^ d3).rotate_left(25);
        let b3 = (a18 ^ d3).rotate_left(21);
        let b19 = (a23 ^ d3).rotate_left(56);
        let b15 = (a4 ^ d4).rotate_left(27);
        let b6 = (a9 ^ d4).rotate_left(20);
        let b22 = (a14 ^ d4).rotate_left(39);
        let b13 = (a19 ^ d4).rotate_left(8);
        let b4 = (a24 ^ d4).rotate_left(14);
        a0 = b0 ^ (!b1 & b2);
        a1 = b1 ^ (!b2 & b3);
        a2 = b2 ^ (!b3 & b4);
        a3 = b3 ^ (!b4 & b0);
        a4 = b4 ^ (!b0 & b1);
        a5 = b5 ^ (!b6 & b7);
        a6 = b6 ^ (!b7 & b8);
        a7 = b7 ^ (!b8 & b9);
        a8 = b8 ^ (!b9 & b5);
        a9 = b9 ^ (!b5 & b6);
        a10 = b10 ^ (!b11 & b12);
        a11 = b11 ^ (!b12 & b13);
        a12 = b12 ^ (!b13 & b14);
        a13 = b13 ^ (!b14 & b10);
        a14 = b14 ^ (!b10 & b11);
        a15 = b15 ^ (!b16 & b17);
        a16 = b16 ^ (!b17 & b18);
        a17 = b17 ^ (!b18 & b19);
        a18 = b18 ^ (!b19 & b15);
        a19 = b19 ^ (!b15 & b16);
        a20 = b20 ^ (!b21 & b22);
        a21 = b21 ^ (!b22 & b23);
        a22 = b22 ^ (!b23 & b24);
        a23 = b23 ^ (!b24 & b20);
        a24 = b24 ^ (!b20 & b21);
        a0 ^= rc;
    }
    *s = [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24];
}

/// Fills `block` with `prefix || data` and Keccak padding. `data` plus the
/// prefix must be shorter than one block.
#[cfg(target_feature = "simd128")]
fn pad_block(prefix: i32, data: &[u8], block: &mut [u8; RATE]) {
    let mut pos = 0;
    if prefix >= 0 {
        block[0] = prefix as u8;
        pos = 1;
    }
    block[pos..pos + data.len()].copy_from_slice(data);
    pos += data.len();
    block[pos..].fill(0);
    block[pos] ^= 0x01;
    block[RATE - 1] ^= 0x80;
}

/// Two Keccak-f[1600] permutations at once on 128-bit SIMD lanes: element 0
/// of every `v128` belongs to the first state, element 1 to the second.
#[cfg(target_feature = "simd128")]
mod x2 {
    use super::{RATE, RC};
    use core::arch::wasm32::*;

    #[inline(always)]
    fn xor(a: v128, b: v128) -> v128 {
        v128_xor(a, b)
    }

    #[inline(always)]
    fn rotl<const L: u32, const R: u32>(v: v128) -> v128 {
        v128_or(i64x2_shl(v, L), u64x2_shr(v, R))
    }

    #[inline(always)]
    #[rustfmt::skip]
    fn keccak_f(s: &mut [v128; 25]) {
        let [mut a0, mut a1, mut a2, mut a3, mut a4, mut a5, mut a6, mut a7, mut a8, mut a9, mut a10, mut a11, mut a12, mut a13, mut a14, mut a15, mut a16, mut a17, mut a18, mut a19, mut a20, mut a21, mut a22, mut a23, mut a24] = *s;
        for rc in RC {
            let c0 = xor(xor(xor(a0, a5), xor(a10, a15)), a20);
            let c1 = xor(xor(xor(a1, a6), xor(a11, a16)), a21);
            let c2 = xor(xor(xor(a2, a7), xor(a12, a17)), a22);
            let c3 = xor(xor(xor(a3, a8), xor(a13, a18)), a23);
            let c4 = xor(xor(xor(a4, a9), xor(a14, a19)), a24);
            let d0 = xor(c4, rotl::<1, 63>(c1));
            let d1 = xor(c0, rotl::<1, 63>(c2));
            let d2 = xor(c1, rotl::<1, 63>(c3));
            let d3 = xor(c2, rotl::<1, 63>(c4));
            let d4 = xor(c3, rotl::<1, 63>(c0));
            let b0 = xor(a0, d0);
            let b16 = rotl::<36, 28>(xor(a5, d0));
            let b7 = rotl::<3, 61>(xor(a10, d0));
            let b23 = rotl::<41, 23>(xor(a15, d0));
            let b14 = rotl::<18, 46>(xor(a20, d0));
            let b10 = rotl::<1, 63>(xor(a1, d1));
            let b1 = rotl::<44, 20>(xor(a6, d1));
            let b17 = rotl::<10, 54>(xor(a11, d1));
            let b8 = rotl::<45, 19>(xor(a16, d1));
            let b24 = rotl::<2, 62>(xor(a21, d1));
            let b20 = rotl::<62, 2>(xor(a2, d2));
            let b11 = rotl::<6, 58>(xor(a7, d2));
            let b2 = rotl::<43, 21>(xor(a12, d2));
            let b18 = rotl::<15, 49>(xor(a17, d2));
            let b9 = rotl::<61, 3>(xor(a22, d2));
            let b5 = rotl::<28, 36>(xor(a3, d3));
            let b21 = rotl::<55, 9>(xor(a8, d3));
            let b12 = rotl::<25, 39>(xor(a13, d3));
            let b3 = rotl::<21, 43>(xor(a18, d3));
            let b19 = rotl::<56, 8>(xor(a23, d3));
            let b15 = rotl::<27, 37>(xor(a4, d4));
            let b6 = rotl::<20, 44>(xor(a9, d4));
            let b22 = rotl::<39, 25>(xor(a14, d4));
            let b13 = rotl::<8, 56>(xor(a19, d4));
            let b4 = rotl::<14, 50>(xor(a24, d4));
            a0 = xor(b0, v128_andnot(b2, b1));
            a1 = xor(b1, v128_andnot(b3, b2));
            a2 = xor(b2, v128_andnot(b4, b3));
            a3 = xor(b3, v128_andnot(b0, b4));
            a4 = xor(b4, v128_andnot(b1, b0));
            a5 = xor(b5, v128_andnot(b7, b6));
            a6 = xor(b6, v128_andnot(b8, b7));
            a7 = xor(b7, v128_andnot(b9, b8));
            a8 = xor(b8, v128_andnot(b5, b9));
            a9 = xor(b9, v128_andnot(b6, b5));
            a10 = xor(b10, v128_andnot(b12, b11));
            a11 = xor(b11, v128_andnot(b13, b12));
            a12 = xor(b12, v128_andnot(b14, b13));
            a13 = xor(b13, v128_andnot(b10, b14));
            a14 = xor(b14, v128_andnot(b11, b10));
            a15 = xor(b15, v128_andnot(b17, b16));
            a16 = xor(b16, v128_andnot(b18, b17));
            a17 = xor(b17, v128_andnot(b19, b18));
            a18 = xor(b18, v128_andnot(b15, b19));
            a19 = xor(b19, v128_andnot(b16, b15));
            a20 = xor(b20, v128_andnot(b22, b21));
            a21 = xor(b21, v128_andnot(b23, b22));
            a22 = xor(b22, v128_andnot(b24, b23));
            a23 = xor(b23, v128_andnot(b20, b24));
            a24 = xor(b24, v128_andnot(b21, b20));
            a0 = xor(a0, u64x2_splat(rc));
        }
        *s = [a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24];
    }

    /// Digests of two single-block padded messages.
    pub fn digest2(a: &[u8; RATE], b: &[u8; RATE], out_a: &mut [u8; 32], out_b: &mut [u8; 32]) {
        let mut state = [u64x2_splat(0); 25];
        for (i, lane) in state.iter_mut().enumerate().take(RATE / 8) {
            let la = u64::from_le_bytes(a[8 * i..8 * i + 8].try_into().unwrap());
            let lb = u64::from_le_bytes(b[8 * i..8 * i + 8].try_into().unwrap());
            *lane = u64x2(la, lb);
        }
        keccak_f(&mut state);
        for i in 0..4 {
            out_a[8 * i..8 * i + 8]
                .copy_from_slice(&u64x2_extract_lane::<0>(state[i]).to_le_bytes());
            out_b[8 * i..8 * i + 8]
                .copy_from_slice(&u64x2_extract_lane::<1>(state[i]).to_le_bytes());
        }
    }
}

pub struct Keccak256;

impl crate::Hash for Keccak256 {
    #[cfg(target_feature = "simd128")]
    fn digest2(prefix: i32, a: &[u8], b: &[u8], out_a: &mut [u8; 32], out_b: &mut [u8; 32]) {
        let room = RATE - 1 - usize::from(prefix >= 0);
        if a.len() > room || b.len() > room {
            Self::digest(prefix, &[a], out_a);
            Self::digest(prefix, &[b], out_b);
            return;
        }
        let (mut block_a, mut block_b) = ([0u8; RATE], [0u8; RATE]);
        pad_block(prefix, a, &mut block_a);
        pad_block(prefix, b, &mut block_b);
        x2::digest2(&block_a, &block_b, out_a, out_b);
    }

    fn digest(prefix: i32, parts: &[&[u8]], out: &mut [u8; 32]) {
        let mut state = [0u64; 25];
        let mut block = [0u8; RATE];
        let mut pos = 0;
        let absorb = |block: &[u8; RATE], state: &mut [u64; 25]| {
            for (lane, chunk) in state.iter_mut().zip(block.chunks_exact(8)) {
                *lane ^= u64::from_le_bytes(chunk.try_into().unwrap());
            }
            keccak_f(state);
        };
        if prefix >= 0 {
            block[0] = prefix as u8;
            pos = 1;
        }
        for part in parts {
            let mut data: &[u8] = part;
            while !data.is_empty() {
                let take = (RATE - pos).min(data.len());
                block[pos..pos + take].copy_from_slice(&data[..take]);
                pos += take;
                data = &data[take..];
                if pos == RATE {
                    absorb(&block, &mut state);
                    pos = 0;
                }
            }
        }
        block[pos..].fill(0);
        block[pos] ^= 0x01;
        block[RATE - 1] ^= 0x80;
        absorb(&block, &mut state);
        for (chunk, lane) in out.chunks_exact_mut(8).zip(state) {
            chunk.copy_from_slice(&lane.to_le_bytes());
        }
    }
}
