#!/usr/bin/env node
// Download + extract a GitHub tarball into bench-fixtures/<name>/.
// Usage: node fetch-fixture.mjs <name> <github-url-of-tarball>
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { repoRoot } from './lib.mjs';

const [, , name, url] = process.argv;
if (!name || !url) {
  console.error('usage: node fetch-fixture.mjs <name> <github-tarball-url>');
  process.exit(1);
}

const outRoot = path.resolve(repoRoot, 'bench-fixtures', name);
const archivePath = path.resolve(repoRoot, 'bench-fixtures', `${name}.tar.gz`);

mkdirSync(path.dirname(archivePath), { recursive: true });

if (!existsSync(archivePath)) {
  console.log(`fetching ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    console.error(`fetch failed: ${response.status} ${response.statusText}`);
    process.exit(1);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  writeFileSync(archivePath, buf);
  console.log(`wrote ${archivePath} (${buf.length} bytes)`);
}

// Decompress: gunzipSync for simplicity (32MB → ~150MB is fine in memory)
const tar = gunzipSync(readFileSync(archivePath));
console.log(`decompressed: ${tar.length} bytes`);

// Parse POSIX tar (ustar). 512-byte header + data padded to 512.
if (existsSync(outRoot)) rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const parseOctal = (buf, off, len) => {
  let s = buf
    .slice(off, off + len)
    .toString('utf8')
    .replace(/\0.*$/, '')
    .trim();
  return s ? parseInt(s, 8) : 0;
};
const parseStr = (buf, off, len) =>
  buf
    .slice(off, off + len)
    .toString('utf8')
    .replace(/\0.*$/, '');

let pos = 0;
let count = 0;
let topPrefix = null;
while (pos + 512 <= tar.length) {
  const header = tar.slice(pos, pos + 512);
  // End-of-archive: two zero blocks
  if (header.every((b) => b === 0)) break;
  const name = parseStr(header, 0, 100);
  const size = parseOctal(header, 124, 12);
  const typeflag = String.fromCharCode(header[156]);
  const prefix = parseStr(header, 345, 155);
  const fullName = prefix ? `${prefix}/${name}` : name;
  pos += 512;
  // Strip the top-level directory of the github tarball (e.g. "TypeScript-main/")
  if (topPrefix == null) {
    const m = fullName.match(/^[^/]+\//);
    topPrefix = m ? m[0] : '';
  }
  const rel = fullName.startsWith(topPrefix) ? fullName.slice(topPrefix.length) : fullName;
  if (rel === '' || rel === '/') {
    // skip top-level dir entry
  } else if (typeflag === '5') {
    mkdirSync(path.join(outRoot, rel), { recursive: true });
  } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
    const data = tar.slice(pos, pos + size);
    const full = path.join(outRoot, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, data);
    count++;
  }
  // skip the data block, padded to 512
  pos += Math.ceil(size / 512) * 512;
}
console.log(`extracted ${count} files to ${outRoot}`);
