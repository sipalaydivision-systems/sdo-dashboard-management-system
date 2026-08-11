'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const hashes = new Map();

function hashOf(file) {
  if (hashes.has(file)) return hashes.get(file);
  let hash = 'dev';
  try {
    const buf = fs.readFileSync(path.join(PUBLIC_DIR, file));
    hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
  } catch (err) {
    console.error(`[assets] could not hash ${file}: ${err.message}`);
  }
  hashes.set(file, hash);
  return hash;
}

function versioned(file) {
  return `/${file}?v=${hashOf(file)}`;
}

function withVersionedAssets(html) {
  return html.replace(
    /(src|href)="\/([a-z0-9_-]+\.(?:js|css))"/gi,
    (_match, attr, file) => `${attr}="${versioned(file)}"`
  );
}

module.exports = { versioned, withVersionedAssets, hashOf };