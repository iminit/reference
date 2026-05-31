// =============================================================================
//  QR Code · Tiny pure-JS QR encoder (Version 1-10, ECC level L)
//  Adapted from public-domain reference implementations. Sufficient for
//  URLs up to ~120 chars at Version 8.
// =============================================================================

import { html } from '../lib.js';

// ---- Galois Field math (256-element field for Reed-Solomon) ----
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (!a || !b) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenPoly(degree) {
  let p = [1];
  for (let i = 0; i < degree; i++) {
    p = polyMul(p, [1, EXP[i]]);
  }
  return p;
}

function polyMul(a, b) {
  const r = new Uint8Array(a.length + b.length - 1);
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      r[i + j] ^= gfMul(a[i], b[j]);
  return r;
}

function rsEncode(data, ecLen) {
  const gen = rsGenPoly(ecLen);
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = buf[i];
    if (coef !== 0)
      for (let j = 0; j < gen.length; j++)
        buf[i + j] ^= gfMul(gen[j], coef);
  }
  return buf.slice(data.length);
}

// ---- QR encoding for Version 1-10, ECC L (byte mode) ----
const VERSION_INFO = {
  // version: { size, dataCodewords (ECC L), ecCodewords, blocks: [[count, dataLen], ...] }
  1:  { size: 21, dataCw: 19,  ecCw: 7,  blocks: [[1,19]] },
  2:  { size: 25, dataCw: 34,  ecCw: 10, blocks: [[1,34]] },
  3:  { size: 29, dataCw: 55,  ecCw: 15, blocks: [[1,55]] },
  4:  { size: 33, dataCw: 80,  ecCw: 20, blocks: [[1,80]] },
  5:  { size: 37, dataCw: 108, ecCw: 26, blocks: [[1,108]] },
  6:  { size: 41, dataCw: 136, ecCw: 18, blocks: [[2,68]] },
  7:  { size: 45, dataCw: 156, ecCw: 20, blocks: [[2,78]] },
  8:  { size: 49, dataCw: 194, ecCw: 24, blocks: [[2,97]] },
  9:  { size: 53, dataCw: 232, ecCw: 30, blocks: [[2,116]] },
  10: { size: 57, dataCw: 274, ecCw: 18, blocks: [[2,68],[2,69]] },
};

// Format info (ECC L, mask m) precomputed; mask we use is 0
const FORMAT_BITS = {
  0: 0x77c4, 1: 0x72f3, 2: 0x7daa, 3: 0x789d, 4: 0x662f, 5: 0x6318, 6: 0x6c41, 7: 0x6976,
};

function selectVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const info = VERSION_INFO[v];
    const charCountBits = (v <= 9) ? 8 : 16;
    const overhead = 4 + charCountBits;
    const maxBytes = (info.dataCw * 8 - overhead) / 8;
    if (byteLen <= Math.floor(maxBytes)) return v;
  }
  return null;
}

function encodeData(text, version) {
  const info = VERSION_INFO[version];
  const bytes = new TextEncoder().encode(text);
  const charCountBits = (version <= 9) ? 8 : 16;
  const totalBits = info.dataCw * 8;

  // Build bit array
  const bits = [];
  const pushBits = (n, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((n >> i) & 1);
  };

  pushBits(0b0100, 4);                    // mode = byte
  pushBits(bytes.length, charCountBits);
  for (const b of bytes) pushBits(b, 8);

  // Terminator + pad to byte
  const remaining = totalBits - bits.length;
  pushBits(0, Math.min(4, remaining));
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes
  const padBytes = [0xec, 0x11];
  let pi = 0;
  while (bits.length < totalBits) {
    pushBits(padBytes[pi % 2], 8);
    pi++;
  }

  // Convert bits to bytes
  const data = new Uint8Array(info.dataCw);
  for (let i = 0; i < info.dataCw; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    data[i] = v;
  }

  // RS error correction
  const codewords = [];
  let dataOffset = 0;
  const ecBlocks = [];
  for (const [count, dataLen] of info.blocks) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(dataOffset, dataOffset + dataLen);
      dataOffset += dataLen;
      codewords.push(block);
      ecBlocks.push(rsEncode(block, info.ecCw));
    }
  }
  // Interleave
  const finalBytes = [];
  const maxData = Math.max(...codewords.map((c) => c.length));
  for (let i = 0; i < maxData; i++)
    for (const c of codewords)
      if (i < c.length) finalBytes.push(c[i]);
  for (let i = 0; i < info.ecCw; i++)
    for (const c of ecBlocks)
      finalBytes.push(c[i]);

  return finalBytes;
}

// ---- Module matrix construction ----
function buildMatrix(version, bytes) {
  const size = VERSION_INFO[version].size;
  const m = Array.from({ length: size }, () => new Int8Array(size).fill(-1));

  // Finder patterns at 3 corners
  const placeFinder = (r, c) => {
    for (let i = -1; i <= 7; i++) {
      for (let j = -1; j <= 7; j++) {
        if (r + i < 0 || r + i >= size || c + j < 0 || c + j >= size) continue;
        const isInner = (i === 0 || i === 6) || (j === 0 || j === 6) ||
                        (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        const isBorder = (i === -1 || i === 7 || j === -1 || j === 7);
        m[r + i][c + j] = (isBorder ? 0 : (isInner ? 1 : 0));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (m[6][i] === -1) m[6][i] = (i % 2 === 0) ? 1 : 0;
    if (m[i][6] === -1) m[i][6] = (i % 2 === 0) ? 1 : 0;
  }

  // Dark module
  m[size - 8][8] = 1;

  // Reserve format info areas (will fill later)
  for (let i = 0; i < 9; i++) if (m[8][i] === -1) m[8][i] = 0;
  for (let i = 0; i < 8; i++) if (m[i][8] === -1) m[i][8] = 0;
  for (let i = size - 8; i < size; i++) if (m[8][i] === -1) m[8][i] = 0;
  for (let i = size - 7; i < size; i++) if (m[i][8] === -1) m[i][8] = 0;

  // Place data bits zigzag
  let bitIdx = 0;
  const bit = (i) => (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  let dir = -1;
  let col = size - 1;
  while (col > 0) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = (dir === -1) ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (m[r][cc] === -1) {
          let v = bitIdx < bytes.length * 8 ? bit(bitIdx) : 0;
          // Apply mask 0: (r + c) % 2 === 0
          if (((r + cc) % 2) === 0) v ^= 1;
          m[r][cc] = v;
          bitIdx++;
        }
      }
    }
    dir = -dir;
    col -= 2;
  }

  // Place format info (ECC L, mask 0)
  const fmt = FORMAT_BITS[0];
  const fmtBits = [];
  for (let i = 14; i >= 0; i--) fmtBits.push((fmt >> i) & 1);
  // Around top-left finder
  for (let i = 0; i < 6; i++) m[i][8] = fmtBits[i];
  m[7][8] = fmtBits[6];
  m[8][8] = fmtBits[7];
  m[8][7] = fmtBits[8];
  for (let i = 9; i < 15; i++) m[8][14 - i] = fmtBits[i];
  // Around top-right & bottom-left finders
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = fmtBits[i];
  for (let i = 8; i < 15; i++) m[size - 1 - (14 - i)][8] = fmtBits[i];

  return m;
}

export function generateQR(text) {
  const bytes = new TextEncoder().encode(text);
  const version = selectVersion(bytes.length);
  if (!version) return null;
  const codewords = encodeData(text, version);
  return buildMatrix(version, codewords);
}

// ---- React component ----
export const QR = ({ text, size = 180 }) => {
  const matrix = generateQR(text);
  if (!matrix) return html`<div class="text-xs text-mute">QR 太大，请缩短链接</div>`;
  const n = matrix.length;
  const cell = size / (n + 2); // 1-module quiet zone each side
  const sz = Math.floor(cell * (n + 2));
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c] === 1) {
        cells.push(html`<rect x=${(c + 1) * cell} y=${(r + 1) * cell} width=${cell + 0.5} height=${cell + 0.5} fill="#0F172A" />`);
      }
    }
  }
  return html`
    <svg width=${sz} height=${sz} viewBox=${`0 0 ${sz} ${sz}`} xmlns="http://www.w3.org/2000/svg">
      <rect width=${sz} height=${sz} fill="white" />
      ${cells}
    </svg>`;
};
