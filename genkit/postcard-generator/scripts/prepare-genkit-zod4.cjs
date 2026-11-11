"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const modules = path.join(root, "node_modules");
const manifest = require("./genkit-zod4-patches.json");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const resolve = relative => {
  const target = path.resolve(modules, relative);
  if (!target.startsWith(modules + path.sep)) throw new Error("Invalid patch path");
  return target;
};
const activePackages = new Set();
for (const [name, version] of Object.entries(manifest.versions)) {
  const packageFile = resolve(name + "/package.json");
  if (!fs.existsSync(packageFile) && manifest.developmentOnly.includes(name)) continue;
  const installed = JSON.parse(fs.readFileSync(packageFile, "utf8"));
  if (installed.version !== version) throw new Error(`Review Zod migration for ${name}@${installed.version}`);
  activePackages.add(name);
}
if (JSON.parse(fs.readFileSync(resolve("zod/package.json"), "utf8")).version !== "4.6.7") {
  throw new Error("The Genkit migration requires the reviewed official Zod 4.6.7 package");
}
// Validate the entire plan before changing any file; subsequent runs are idempotent.
const patches = manifest.patches.filter(patch => [...activePackages].some(name => patch.path.startsWith(name + "/")));
const plan = patches.map(patch => {
  const target = resolve(patch.path);
  const before = fs.readFileSync(target, "utf8");
  if (hash(before) === patch.afterSha256) return null;
  if (hash(before) !== patch.beforeSha256) throw new Error(`Upstream content changed: ${patch.path}`);
  let after = before;
  for (const change of patch.changes) {
    const parts = after.split(change.before);
    if (parts.length - 1 !== change.count) throw new Error(`Patch context changed: ${patch.path}`);
    after = parts.join(change.after);
  }
  if (hash(after) !== patch.afterSha256) throw new Error(`Patch output mismatch: ${patch.path}`);
  return { target, after };
}).filter(Boolean);
for (const { target, after } of plan) fs.writeFileSync(target, after);
for (const patch of patches) {
  if (hash(fs.readFileSync(resolve(patch.path))) !== patch.afterSha256) throw new Error(`Patch verification failed: ${patch.path}`);
}
console.log(`Verified Zod 4 compatibility in ${patches.length} pinned Genkit files (${plan.length} updated).`);
