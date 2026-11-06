#!/usr/bin/env node
// Full npm audit gate with documented, dated, per-advisory exceptions.
// Fails when any advisory at or above the configured level is not listed in
// audit-exceptions.json, or when a listed exception is past its reviewBy date.
// Development dependencies stay in scope, matching `npm audit --audit-level=high`.
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- standalone CommonJS CI script */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "audit-exceptions.json"), "utf8"));
const levels = ["info", "low", "moderate", "high", "critical"];
const threshold = levels.indexOf(config.auditLevel || "high");
if (threshold < 0) throw new Error(`Unknown auditLevel ${config.auditLevel}`);

const today = new Date().toISOString().slice(0, 10);
const active = new Map();
let failed = false;
for (const entry of config.exceptions || []) {
  if (!/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(entry.id) || !entry.reason || !entry.added || !/^\d{4}-\d{2}-\d{2}$/.test(entry.reviewBy || "")) {
    console.error(`Invalid exception entry: ${JSON.stringify(entry)}`);
    failed = true;
    continue;
  }
  if (today > entry.reviewBy) {
    console.error(`Exception ${entry.id} expired on ${entry.reviewBy}; review it before the audit can pass.`);
    failed = true;
    continue;
  }
  active.set(entry.id, entry);
}

const result = spawnSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(result.stdout);
}
catch {
  console.error("npm audit did not return JSON.");
  console.error(result.stderr);
  process.exit(1);
}
if (report.error || !report.vulnerabilities) {
  console.error("npm audit failed:", JSON.stringify(report.error || report));
  process.exit(1);
}

// Collect each distinct advisory once; package records that only propagate a
// parent finding resolve to the same advisory objects.
const advisories = new Map();
for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue;
    const id = (String(via.url || "").match(/GHSA-[a-z0-9-]+/) || [String(via.source)])[0];
    const seen = advisories.get(id) || { id, severity: via.severity, name: via.name, title: via.title, packages: new Set() };
    seen.packages.add(pkg);
    advisories.set(id, seen);
  }
}

const counts = report.metadata && report.metadata.vulnerabilities;
console.log(`npm audit package records: ${JSON.stringify(counts)}`);
const used = new Set();
for (const adv of advisories.values()) {
  if (levels.indexOf(adv.severity) < threshold) continue;
  const exception = active.get(adv.id);
  if (exception) {
    used.add(adv.id);
    console.log(`EXCEPTED ${adv.severity} ${adv.id} (${adv.name}: ${adv.title}) until ${exception.reviewBy}: ${exception.reason}`);
  }
  else {
    failed = true;
    console.error(`FAIL ${adv.severity} ${adv.id} (${adv.name}: ${adv.title}) in ${[...adv.packages].join(", ")}`);
  }
}
for (const id of active.keys()) {
  if (!used.has(id)) console.log(`NOTE exception ${id} no longer matches any finding; remove it.`);
}

if (failed) {
  console.error(`Audit failed at level ${config.auditLevel}.`);
  process.exit(1);
}
console.log(`Audit passed at level ${config.auditLevel}: no unexcepted ${config.auditLevel}-or-above advisories.`);
