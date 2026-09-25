// Generates JARVIS *placeholder* icons (flat cyan) only when no icons exist yet.
// The real branded icons are committed in src-tauri/icons/ (built from the
// Iron-Man helmet via `python ../make-icon.py`), so this never clobbers them.
// Run: npm run icons   (regenerate placeholders: delete src-tauri/icons/icon.ico first)

import { mkdirSync, writeFileSync, existsSync } from "fs";
import { deflateSync } from "zlib";
import { join } from "path";

const DIR = join("src-tauri", "icons");
mkdirSync(DIR, { recursive: true });

// Don't overwrite real branded icons if they're already present.
if (existsSync(join(DIR, "icon.ico")) && existsSync(join(DIR, "tray_icon.rgba"))) {
  console.log("✓  src-tauri/icons already present — keeping branded icons.");
  process.exit(0);
}

const ACCENT = [0, 229, 255]; // JARVIS cyan #00e5ff

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size, [r, g, b]) {
  const raw = Buffer.alloc((1 + size * 4) * size);
  for (let y = 0; y < size; y++) {
    const off = y * (1 + size * 4);
    raw[off] = 0;
    for (let x = 0; x < size; x++) {
      const i = off + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(size) {
  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0);
  bih.writeInt32LE(size, 4);
  bih.writeInt32LE(size * 2, 8);
  bih.writeUInt16LE(1, 12);
  bih.writeUInt16LE(32, 14);

  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4 + 0] = ACCENT[2];
    px[i * 4 + 1] = ACCENT[1];
    px[i * 4 + 2] = ACCENT[0];
    px[i * 4 + 3] = 255;
  }

  const maskRowBytes = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(size * maskRowBytes);
  const imageData = Buffer.concat([bih, px, mask]);

  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2);
  hdr.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(imageData.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([hdr, entry, imageData]);
}

writeFileSync(join(DIR, "icon.ico"), makeIco(256));
writeFileSync(join(DIR, "32x32.png"), makePng(32, ACCENT));
writeFileSync(join(DIR, "128x128.png"), makePng(128, ACCENT));
writeFileSync(join(DIR, "128x128@2x.png"), makePng(256, ACCENT));
console.log("✓  src-tauri/icons/icon.ico + PNG bundle icons created.");

const tray = Buffer.alloc(32 * 32 * 4);
for (let i = 0; i < 32 * 32; i++) {
  tray[i * 4 + 0] = ACCENT[0];
  tray[i * 4 + 1] = ACCENT[1];
  tray[i * 4 + 2] = ACCENT[2];
  tray[i * 4 + 3] = 255;
}
writeFileSync(join(DIR, "tray_icon.rgba"), tray);
console.log("✓  src-tauri/icons/tray_icon.rgba created.");
console.log("    Run `python setup-icon.py <logo.png>` for branded icons.");
