const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");

const project = path.resolve(__dirname, "..");
const dependency = (relative) => path.join(project, "node_modules", relative);
const { z } = require("../scripts/genkit-zod4-compat.cjs");
const native = require("zod").z;
const core = require(dependency("@genkit-ai/core/lib/schema.js"));
const jsonSchema = require("../scripts/genkit-json-schema.cjs");

test("Genkit schemas use the patched validator and preserve optional values and partial records", () => {
  assert.equal(require("zod/package.json").version, "4.6.7");
  assert.equal(z.array, native.array);
  assert.equal(z.set, native.set);
  const schema = z.object({ value: z.any(), metadata: z.unknown() });
  assert.equal(schema.safeParse({}).success, true);
  assert.equal(z.record(z.number()).safeParse({ count: 2 }).success, true);
  assert.equal(z.record(z.number()).safeParse({ count: "bad" }).success, false);
  const fields = z.record(z.enum(["input", "output"]), z.string());
  assert.equal(fields.safeParse({ input: "value" }).success, true);
  assert.equal(fields.safeParse({ unrelated: "value" }).success, false);
  assert.equal(fields.safeParse({ input: 2 }).success, false);
});

test("all exported application and CLI schemas retain structural JSON schemas without a permissive fallback", () => {
  let count = 0;
  for (const folder of ["@genkit-ai/ai/lib", "@genkit-ai/tools-common/lib/cjs/src/types"]) {
    for (const file of fs.readdirSync(dependency(folder)).filter((name) => name.endsWith(".js"))) {
      for (const [name, schema] of Object.entries(require(dependency(`${folder}/${file}`)))) {
        if (!schema || typeof schema.safeParse !== "function" || !schema._def) continue;
        assert.ok(schema._zod, `${file}:${name} must use the native Zod 4 schema`);
        const converted = core.toJsonSchema({ schema });
        assert.equal(converted.$schema, "http://json-schema.org/draft-07/schema#");
        if (schema._zod.def.type === "object") {
          assert.equal(converted.type, "object", `${file}:${name}`);
          assert.deepEqual(Object.keys(converted.properties), Object.keys(schema.shape));
        }
        count++;
      }
    }
  }
  assert.equal(count, 385, "A dependency export change requires migration review");
  assert.throws(() => jsonSchema(z.custom(() => true)), /cannot be represented/);
  const bounded = jsonSchema(z.set(z.string()).min(1).max(2));
  assert.deepEqual(bounded.items, { type: "string" });
  assert.equal(bounded.uniqueItems, true);
  assert.equal(bounded.minItems, 1);
  assert.equal(bounded.maxItems, 2);
});

test("actual model response validation accepts existing output and rejects nested invalid content", async () => {
  const { GenerateResponseSchema } = require(dependency("@genkit-ai/ai/lib/model.js"));
  const valid = {
    message: { role: "model", content: [{ text: "postcard story" }] },
    finishReason: "stop",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
  assert.equal(GenerateResponseSchema.safeParse(valid).success, true);
  assert.equal(core.validateSchema(valid, { schema: GenerateResponseSchema }).valid, true);
  for (const invalid of [
    { ...valid, finishReason: "invalid" },
    { ...valid, message: { ...valid.message, role: "invalid" } },
    { ...valid, message: { ...valid.message, content: [{ text: 42 }] } },
    { ...valid, message: { ...valid.message, content: [{ media: {} }] } },
    { ...valid, usage: { inputTokens: "invalid" } },
  ]) {
    assert.equal(GenerateResponseSchema.safeParse(invalid).success, false);
    assert.equal(core.validateSchema(invalid, { schema: GenerateResponseSchema }).valid, false);
  }
  const esm = await import(pathToFileURL(dependency("@genkit-ai/core/lib/schema.mjs")));
  assert.deepEqual(esm.toJsonSchema({ schema: GenerateResponseSchema }), core.toJsonSchema({ schema: GenerateResponseSchema }));
  assert.equal(esm.validateSchema(valid, { schema: GenerateResponseSchema }).valid, true);
  const { GenerateRequestSchema } = require(dependency("@genkit-ai/ai/lib/model.js"));
  const tools = core.toJsonSchema({ schema: GenerateRequestSchema }).properties.tools.items.properties;
  assert.equal(tools.inputSchema.description, "Valid JSON Schema representing the input of the tool.");
  assert.equal(tools.outputSchema.description, "Valid JSON Schema describing the output of the tool.");
});

test("the actual evaluator configuration preserves partial selectors and validates callback input", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "postcard-evaluator-"));
  try {
    fs.writeFileSync(path.join(temporary, "genkit-tools.conf.js"), "module.exports = { evaluators: [{ extractors: { input: trace => trace.traceId, output: async trace => trace.traceId } }] };\n");
    const code = `
      const assert = require('node:assert/strict');
      const config = require(${JSON.stringify(dependency("@genkit-ai/tools-common/lib/cjs/src/plugin/config.js"))});
      const { TraceDataSchema } = require(${JSON.stringify(dependency("@genkit-ai/tools-common/lib/cjs/src/types/trace.js"))});
      (async () => {
        const result = await config.findToolsConfig();
        assert.ok(result);
        const extract = result.evaluators[0].extractors.input;
        const trace = { traceId: 'trace', displayName: 'postcard', startTime: 1, endTime: 2, spans: {} };
        assert.equal(TraceDataSchema.safeParse(trace).success, true);
        assert.equal(extract(trace), 'trace');
        assert.equal(await result.evaluators[0].extractors.output(trace), 'trace');
        assert.throws(() => extract({ ...trace, spans: { bad: { traceId: 123 } } }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ["-e", code], { cwd: temporary, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("the installation guard detects upstream drift before writes and supports production-only installs", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "postcard-install-guard-"));
  const manifest = require("../scripts/genkit-zod4-patches.json");
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  try {
    fs.mkdirSync(path.join(temporary, "scripts"));
    for (const name of ["prepare-genkit-zod4.cjs", "genkit-zod4-patches.json"]) {
      fs.copyFileSync(path.join(project, "scripts", name), path.join(temporary, "scripts", name));
    }
    const packages = { ...manifest.versions, zod: "4.6.7" };
    for (const [name, version] of Object.entries(packages)) {
      const folder = path.join(temporary, "node_modules", name);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name, version }));
    }
    const originals = new Map();
    for (const patch of manifest.patches) {
      let before = fs.readFileSync(dependency(patch.path), "utf8");
      assert.equal(hash(before), patch.afterSha256);
      for (const change of [...patch.changes].reverse()) before = before.split(change.after).join(change.before);
      assert.equal(hash(before), patch.beforeSha256);
      const file = path.join(temporary, "node_modules", patch.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, before);
      originals.set(file, before);
    }
    const altered = [...originals.keys()].at(-1);
    fs.appendFileSync(altered, "\n// unreviewed upstream change\n");
    originals.set(altered, fs.readFileSync(altered, "utf8"));
    const run = () => spawnSync(process.execPath, [path.join(temporary, "scripts/prepare-genkit-zod4.cjs")], { encoding: "utf8", timeout: 10000 });
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Upstream content changed/);
    for (const [file, content] of originals) assert.equal(fs.readFileSync(file, "utf8"), content);
    fs.writeFileSync(altered, originals.get(altered).replace("\n// unreviewed upstream change\n", ""));
    assert.equal(run().status, 0);
    const repeated = run();
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.match(repeated.stdout, /0 updated/);
    for (const name of manifest.developmentOnly) {
      fs.rmSync(path.join(temporary, "node_modules", name), { recursive: true });
    }
    const production = run();
    assert.equal(production.status, 0, production.stderr);
    assert.match(production.stdout, /10 pinned Genkit files/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("oversized arrays and sets stop before validating elements, including async parsing", async () => {
  let calls = 0;
  const element = z.string().superRefine(() => { calls++; });
  const array = z.array(element).max(2);
  assert.equal(array.safeParse(["a", "b", "c"]).success, false);
  assert.equal(calls, 0);
  assert.equal((await array.safeParseAsync(["a", "b", "c"])).success, false);
  assert.equal(calls, 0);
  assert.equal(z.set(element).max(2).safeParse(new Set(["a", "b", "c"])).success, false);
  assert.equal(calls, 0);
  assert.equal(array.safeParse(["a", "b"]).success, true);
  assert.equal(calls, 2);
  let reads = 0;
  const oversized = ["a", "b", "c"];
  Object.defineProperty(oversized, 0, { get() { reads++; return "a"; } });
  assert.equal(core.validateSchema(oversized, { schema: array }).valid, false);
  assert.equal(reads, 0, "Genkit's actual JSON validator must also enforce the bound before reading elements");
});

test("actual plugin hooks validate flags and sync/async returns while preserving the receiver", async () => {
  const { BaseToolPluginActionSchema } = require(dependency("@genkit-ai/tools-common/lib/cjs/src/plugin/plugins.js"));
  assert.equal(BaseToolPluginActionSchema.safeParse({ hook: "not a function" }).success, false);
  let calls = 0;
  const context = { marker: "receiver" };
  const hook = BaseToolPluginActionSchema.parse({ hook(flags, extra) {
    assert.equal(this, context);
    assert.deepEqual(flags, { region: "test", enabled: true });
    assert.equal(extra, "extra");
    calls++;
  } }).hook;
  assert.throws(() => hook.call(context, { invalid: 3 }), /invalid|expected/i);
  assert.equal(calls, 0);
  hook.call(context, { region: "test", enabled: true }, "extra");
  assert.equal(calls, 1);
  assert.equal(BaseToolPluginActionSchema.parse({ hook() {} }).hook(), undefined);
  await BaseToolPluginActionSchema.parse({ async hook() {} }).hook();
  assert.throws(() => BaseToolPluginActionSchema.parse({ hook: () => "invalid" }).hook());
  await assert.rejects(BaseToolPluginActionSchema.parse({ hook: async () => "invalid" }).hook());
});

test("the real CLI API generator preserves its actions and execution endpoints", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "postcard-openapi-"));
  try {
    const result = spawnSync(process.execPath, [dependency("@genkit-ai/tools-common/lib/cjs/src/api/reflection.js"), temporary], {
      cwd: project, encoding: "utf8", timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    const document = require("yaml").parse(fs.readFileSync(path.join(temporary, "reflectionApi.yaml"), "utf8"));
    assert.equal(document.openapi, "3.0.0");
    assert.ok(document.paths["/api/actions"].get.responses["200"]);
    assert.ok(document.paths["/api/runAction"].post.requestBody);
    for (const name of ["CustomAny", "JSONSchema7", "Action", "TraceData", "SpanData"]) {
      assert.ok(document.components.schemas[name], name);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
