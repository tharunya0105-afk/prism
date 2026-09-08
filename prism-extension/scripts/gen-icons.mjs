// Generates extension icons (16/32/48/128 PNG) with zero dependencies:
// navy tile + teal prism triangle, rasterized by hand and PNG-encoded with zlib.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(OUT, { recursive: true });

// ---------- PNG encoding ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- drawing ----------
const BG = [10, 14, 19, 255]; // #0a0e13
const OUTER = [30, 158, 125, 255]; // #1e9e7d
const INNER = [45, 212, 167, 255]; // #2dd4a7

function pointInTri(px, py, a, b, c) {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  const d1 = s([px, py], a, b);
  const d2 = s([px, py], b, c);
  const d3 = s([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const o = size * 0.12;
  const inner = size * 0.34;
  const outerTop = [cx, o];
  const outerR = [size - o, size - o];
  const outerL = [o, size - o];
  const innerTop = [cx, o + (size - 2 * o) * 0.36];
  const innerR = [cx + inner * 0.9, size - o - (size - 2 * o) * 0.14];
  const innerL = [cx - inner * 0.9, size - o - (size - 2 * o) * 0.14];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let col = BG;
      if (pointInTri(px, py, innerTop, innerR, innerL)) col = INNER;
      else if (pointInTri(px, py, outerTop, outerR, outerL)) col = OUTER;
      const i = (y * size + x) * 4;
      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = col[3];
    }
  }
  return encodePNG(size, size, rgba);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(OUT, `${size}.png`), draw(size));
  console.log(`icons/${size}.png`);
}
console.log("done");