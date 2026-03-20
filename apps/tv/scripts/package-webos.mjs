/**
 * Script de packaging WebOS
 * 1. Génère les icônes PNG si absentes
 * 2. Copie appinfo.json + icônes dans dist/
 * 3. Lance ares-package
 */
import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dist = resolve(root, 'dist');
const build = resolve(root, 'build');

if (!existsSync(build)) mkdirSync(build, { recursive: true });

// ── PNG generator (pur Node.js, aucune dépendance) ─────────────────────────

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([t, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, t, data, crcBuf]);
}

function makePng(w, h, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // RGB

  // Scanlines: filter byte (0) + RGB pixels
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const base = y * (1 + w * 3);
    raw[base] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      raw[base + 1 + x * 3] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Générer les icônes ──────────────────────────────────────────────────────

const iconsDir = resolve(root, 'public', 'icons');
if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

const icon80 = resolve(iconsDir, 'icon80x80.png');
const icon130 = resolve(iconsDir, 'icon130x130.png');

if (!existsSync(icon80)) {
  writeFileSync(icon80, makePng(80, 80, 229, 9, 20)); // #e50914
  console.log('✅  icon80x80.png généré');
}
if (!existsSync(icon130)) {
  writeFileSync(icon130, makePng(130, 130, 229, 9, 20)); // #e50914
  console.log('✅  icon130x130.png généré');
}

// ── Copier les assets dans dist/ ────────────────────────────────────────────

copyFileSync(resolve(root, 'public', 'appinfo.json'), resolve(dist, 'appinfo.json'));

const distIcons = resolve(dist, 'icons');
if (!existsSync(distIcons)) mkdirSync(distIcons, { recursive: true });
copyFileSync(icon80, resolve(distIcons, 'icon80x80.png'));
copyFileSync(icon130, resolve(distIcons, 'icon130x130.png'));

// ── ares-package ────────────────────────────────────────────────────────────

try {
  execSync(`ares-package "${dist}" -o "${build}"`, { stdio: 'inherit' });
  console.log('\n✅  IPK créé dans apps/tv/build/');
  console.log('👉  Pour installer : ares-install apps/tv/build/com.nasflix.tv_1.0.0_all.ipk --device lgtv');
  console.log('👉  Pour lancer   : ares-launch com.nasflix.tv --device lgtv');
} catch {
  console.error('\n❌  ares-package introuvable. Installez le SDK WebOS :');
  console.error('    npm install -g @webosose/ares-cli');
  console.error('\nLe build Vite est prêt dans apps/tv/dist/ — packaging échoué seulement.');
  process.exit(1);
}
