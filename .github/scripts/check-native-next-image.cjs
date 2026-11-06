// Exercise the optimizer's actual native Sharp consumer against the frozen lock.
// Version auditing is a separate job; this checks runtime compatibility.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const app = process.cwd();
const req = createRequire(path.join(app, 'package.json'));
const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json'), 'utf8'));
const fromNext = createRequire(req.resolve('next/package.json'));
const nextPackage = req('next/package.json');
const sharp = fromNext('sharp');
const sharpDir = path.resolve(path.dirname(fromNext.resolve('sharp')), '..');
const sharpPackage = JSON.parse(fs.readFileSync(path.join(sharpDir, 'package.json'), 'utf8'));
const sharpLockPath = path.relative(app, sharpDir).split(path.sep).join('/');
assert.equal(nextPackage.version, lock.packages['node_modules/next'].version);
assert.equal(sharpPackage.version, lock.packages[sharpLockPath]?.version);
const optimizer = req('next/dist/server/image-optimizer');
const optimizeImage = optimizer.optimizeImage || req('next/dist/server/image-optimizer/transform').optimizeImage;
(async () => {
  const png = await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 32, g: 64, b: 128 } } }).png().toBuffer();
  const optimized = await optimizeImage({ buffer: png, contentType: 'image/png', quality: 75, width: 2 });
  const metadata = await sharp(optimized).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 1);
  assert.equal(metadata.format, 'png');
  console.log(JSON.stringify({ node: process.version, next: nextPackage.version, sharp: sharpPackage.version, image: { width: metadata.width, height: metadata.height, format: metadata.format }, status: 'PASS' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
