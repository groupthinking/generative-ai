const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadFlow({ authorized = true, authEnabled = true } = {}) {
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, '../libs/genkit/flows.ts'), 'utf8');
  const dependencies = {
    '@/libs/maps/maps': { renderMap: async (...args) => { calls.push(['map', ...args]); return 'map-base64'; } },
    './schema': {},
    './config': {
      initializeGenkitTelemetry: async () => calls.push(['telemetry']),
      ai: {
        defineFlow: (config, handler) => { calls.push(['define', config.name]); return handler; },
        prompt: name => async input => {
          calls.push([name, input]);
          return name === 'postcard-map'
            ? { output: { description: 'A scenic route', story: 'Hello from the road' }, text: 'Structured story text' }
            : { media: { url: 'https://example.invalid/postcard.png' } };
        },
      },
    },
    'next/headers': { headers: async () => new Headers(authorized ? { Authorization: 'Bearer valid-token' } : {}) },
    'firebase-admin/auth': { getAuth: () => ({ verifyIdToken: async token => { calls.push(['verify', token]); return { uid: 'user' }; } }) },
    '@/libs/firebase/serverApp': { firebaseServerApp: {} },
  };
  const context = { exports: {}, process: { env: { AUTH_ENABLED: String(authEnabled) } }, require: name => {
    if (name in dependencies) return dependencies[name];
    throw new Error('Unexpected import: ' + name);
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return { ...context.exports, calls };
}
const postcard = { start: 'London', end: 'Paris', stops: ['Dover'], sender: 'Alice', recipient: 'Bob' };

test('requires authentication before telemetry, map or model calls', async () => {
  const flow = loadFlow({ authorized: false });
  await assert.rejects(flow.callPostcardFlow(postcard), /Missing Authorization Header/);
  assert.deepEqual(flow.calls.map(c => c[0]), ['define']);
});

test('preserves authenticated map, prompt and image output behavior with Genkit 1', async () => {
  const flow = loadFlow();
  const result = await flow.callPostcardFlow(postcard);
  assert.deepEqual(flow.calls.map(c => c[0]), ['define', 'verify', 'telemetry', 'map', 'postcard-map', 'postcard-image']);
  assert.equal(flow.calls[1][1], 'valid-token');
  assert.deepEqual(flow.calls[3].slice(1), ['London', 'Paris', ['Dover']]);
  assert.equal(flow.calls[4][1].mapImage, 'data:image/png;base64,map-base64');
  assert.equal(flow.calls[4][1].sender, 'Alice');
  assert.equal(flow.calls[4][1].recipient, 'Bob');
  assert.equal(flow.calls[5][1].story, 'Structured story text');
  assert.equal(result.description, 'A scenic route');
  assert.equal(result.story, 'Hello from the road');
  assert.equal(result.image, 'https://example.invalid/postcard.png');
  assert.equal(result.map, 'data:image/png;base64,map-base64');
});

test('preserves explicitly disabled auth mode', async () => {
  const flow = loadFlow({ authorized: false, authEnabled: false });
  await flow.callPostcardFlow(postcard);
  assert.equal(flow.calls.some(c => c[0] === 'verify'), false);
  assert.equal(flow.calls.some(c => c[0] === 'postcard-image'), true);
});
