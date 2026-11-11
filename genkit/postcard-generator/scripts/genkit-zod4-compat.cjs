"use strict";
// These adapters are restricted to the pinned Genkit consumers. Validation uses Zod 4.
const native = require("zod");
const z = {
  ...native.z,
  // Zod 3 accepted a missing key for any()/unknown(), including object properties.
  any: (...args) => native.z.any(...args).optional(),
  unknown: (...args) => native.z.unknown(...args).optional(),
  // Legacy one-argument records have string keys; enum records allow missing keys.
  record: (...args) => args.length === 1
    ? native.z.record(native.z.string(), args[0])
    : native.z.partialRecord(...args),
};
module.exports = { ...native, ...z };
module.exports.z = z;
module.exports.default = z;
Object.defineProperty(module.exports, "__esModule", { value: true });
