const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadTS(file, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const context = { exports: {}, require, ...globals };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context.exports;
}
function worklet(file) {
  let Registered;
  const messages = [];
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: value => messages.push(value) }; } }
  const context = { AudioWorkletProcessor, ArrayBuffer, DataView, Float32Array, registerProcessor: (_name, constructor) => { Registered = constructor; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/audio/', file), 'utf8'), context);
  return { node: new Registered(), messages };
}

test('recorder converts real input samples to clipped little-endian PCM16 and tracks speech', () => {
  const { node, messages } = worklet('pcm-recorder.js');
  node.process([[new Float32Array([-2, -1, 0, 0.5, 1, 2])]]);
  const pcm = new DataView(messages[0].pcm);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => pcm.getInt16(i * 2, true)), [-32768, -32768, 0, 16384, 32767, 32767]);
  assert.equal(messages[0].speaking, true);
  node.process([[new Float32Array(4800)]]);
  assert.equal(messages[1].speaking, false);
});

test('player preserves queued PCM order and clears output when interrupted', () => {
  const { node } = worklet('pcm-player.js');
  const buffer = new ArrayBuffer(8); const pcm = new DataView(buffer);
  [-32768, 0, 16384, 32767].forEach((sample, i) => pcm.setInt16(i * 2, sample, true));
  node.port.onmessage({ data: buffer });
  const first = new Float32Array(2); node.process([], [[first]]);
  assert.deepEqual([...first], [-1, 0]);
  const second = new Float32Array(2); node.process([], [[second]]);
  assert.deepEqual([...second], [0.5, 32767 / 32768]);
  node.port.onmessage({ data: buffer });
  node.port.onmessage({ data: { command: 'stopAudio' } });
  const silence = new Float32Array([1, 1]); node.process([], [[silence]]);
  assert.deepEqual([...silence], [0, 0]);
});

test('microphone permission errors propagate without starting a worklet', async () => {
  let loaded = false;
  const { startAudioRecorderWorklet } = loadTS('lib/audio-recorder.ts', { navigator: { mediaDevices: { getUserMedia: async () => { throw new Error('Permission denied'); } } } });
  await assert.rejects(startAudioRecorderWorklet({ sampleRate: 16000, audioWorklet: { addModule: async () => { loaded = true; } } }, () => {}, () => {}, () => {}), /Permission denied/);
  assert.equal(loaded, false);
});

test('a worklet loading failure stops every acquired microphone track', async () => {
  let stops = 0;
  const stream = { getTracks: () => [{ stop: () => stops++ }, { stop: () => stops++ }] };
  const { startAudioRecorderWorklet } = loadTS('lib/audio-recorder.ts', { navigator: { mediaDevices: { getUserMedia: async () => stream } } });
  await assert.rejects(startAudioRecorderWorklet({ sampleRate: 16000, audioWorklet: { addModule: async () => { throw new Error('Module unavailable'); } } }, () => {}, () => {}, () => {}), /Module unavailable/);
  assert.equal(stops, 2);
});

test('capture connects the provided source graph and forwards PCM and speech transitions', async () => {
  const events = []; let node;
  const stream = { getTracks: () => [] };
  class AudioWorkletNode { constructor() { this.port = {}; node = this; } connect(target) { events.push(['output', target]); } }
  const context = { sampleRate: 16000, destination: 'speaker', audioWorklet: { addModule: async url => events.push(['module', url]) }, createMediaStreamSource: actual => { assert.equal(actual, stream); return { connect: actualNode => events.push(['input', actualNode]) }; } };
  const { startAudioRecorderWorklet } = loadTS('lib/audio-recorder.ts', { AudioWorkletNode, navigator: { mediaDevices: { getUserMedia: async () => stream } } });
  const result = await startAudioRecorderWorklet(context, pcm => events.push(['pcm', pcm]), () => events.push(['speech-start']), speaking => events.push(['speaking', speaking]));
  assert.equal(result[0], node); assert.equal(result[1], context); assert.equal(result[2], stream);
  const pcm = new ArrayBuffer(2);
  node.port.onmessage({ data: { pcm, speaking: true } });
  node.port.onmessage({ data: { pcm, speaking: true } });
  node.port.onmessage({ data: { pcm, speaking: false } });
  assert.equal(events.filter(e => e[0] === 'speech-start').length, 1);
  assert.equal(events.filter(e => e[0] === 'pcm').length, 3);
  assert.deepEqual(events.filter(e => e[0] === 'speaking').map(e => e[1]), [true, false]);
});

test('backend URL follows configured TLS and existing API router path', () => {
  const { getWebSocketUrl } = loadTS('lib/config.ts', { URL, process: { env: { NEXT_PUBLIC_BACKEND_URL: 'https://backend.example/base/' } }, window: { location: { hostname: 'app.example', origin: 'https://app.example' } } });
  assert.equal(getWebSocketUrl(), 'wss://backend.example/base/api/websocket/ws');
});

test('the default local backend matches documented port and session IDs persist', () => {
  const storage = new Map(); let generated = 0;
  const api = loadTS('lib/config.ts', { URL, process: { env: {} }, crypto: { randomUUID: () => { generated++; return 'unique-session'; } }, window: { location: { hostname: 'localhost', origin: 'http://localhost:3000' }, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } } });
  assert.equal(api.getWebSocketUrl(), 'ws://localhost:8000/api/websocket/ws');
  assert.equal(api.getSessionId(), 'unique-session'); assert.equal(api.getSessionId(), 'unique-session'); assert.equal(generated, 1);
});
