const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

test('telemetry shares concurrent startup, retries a failure, and caches success', async () => {
  const attempts = [];
  const dependencies = {
    'google-auth-library': { GoogleAuth: class {} },
    genkit: { genkit: () => ({}) },
    'genkit/logging': { logger: { setLogLevel() {} } },
    '@genkit-ai/vertexai': { vertexAI: () => ({}) },
    'genkitx-ollama': { ollama: () => ({}) },
    '@opentelemetry/sdk-trace-base': { AlwaysOnSampler: class {} },
    '@genkit-ai/google-cloud': {
      enableGoogleCloudTelemetry: options => new Promise((resolve, reject) => {
        attempts.push({ options, resolve, reject });
      }),
    },
  };
  const context = {
    exports: {},
    process: { env: {} },
    require: name => {
      if (!(name in dependencies)) throw new Error('Unexpected import: ' + name);
      return dependencies[name];
    },
  };
  const source = fs.readFileSync(path.join(__dirname, '../libs/genkit/config.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const { initializeGenkitTelemetry } = context.exports;

  const first = initializeGenkitTelemetry();
  const concurrent = initializeGenkitTelemetry();
  assert.equal(first, concurrent, 'one pending initialization serves concurrent requests');
  assert.equal(attempts.length, 1);
  const failure = new Error('controlled temporary telemetry failure');
  attempts[0].reject(failure);
  const rejected = await Promise.allSettled([first, concurrent]);
  assert.ok(rejected.every(result => result.status === 'rejected' && result.reason === failure));

  const retry = initializeGenkitTelemetry();
  assert.notEqual(retry, first, 'a failed attempt must not poison subsequent requests');
  assert.equal(attempts.length, 2);
  assert.equal(initializeGenkitTelemetry(), retry);
  assert.equal(attempts[1].options.forceDevExport, true);
  assert.equal(attempts[1].options.autoInstrumentation, true);
  assert.equal(attempts[1].options.autoInstrumentationConfig['@opentelemetry/instrumentation-fs'].enabled, false);
  attempts[1].resolve();
  await retry;
  assert.equal(initializeGenkitTelemetry(), retry, 'successful initialization stays cached');
  assert.equal(attempts.length, 2);
});
