/**
 * Browser integration regression for the real audio session component.
 * Run: node tests/audio-session.browser.cjs
 * From the repository root, install the pinned test tools with:
 * npm ci --prefix .github/testing/audio-browser --ignore-scripts
 * node .github/testing/audio-browser/node_modules/playwright/cli.js install chromium
 * Explicit installed tool paths may be supplied through AUDIO_TEST_ESBUILD_MODULE
 * and AUDIO_TEST_PLAYWRIGHT_MODULE; AUDIO_TEST_BROWSER_CHANNEL optionally selects
 * an installed browser for an additional compatibility check.
 * Optional AUDIO_TEST_RESULT records the complete result JSON at that path.
 * Uses fake microphone input and controlled socket transport, never a backend
 * or model provider. Actual React, AudioContexts, worklets, and component effects
 * must retain active contexts on notification reconnect, then release them on
 * session stop/unmount. Retry must create new working contexts.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const app = path.resolve(__dirname, '..');
const testTools = path.resolve(app, '../../../../../..', '.github/testing/audio-browser/node_modules');
const playwrightPath = process.env.AUDIO_TEST_PLAYWRIGHT_MODULE || path.join(testTools, 'playwright');
const esbuild = require(process.env.AUDIO_TEST_ESBUILD_MODULE || path.join(testTools, 'esbuild'));
const { chromium } = require(playwrightPath);
const browserChannel = process.env.AUDIO_TEST_BROWSER_CHANNEL;
const expectedBrowser = JSON.parse(fs.readFileSync(path.join(path.dirname(playwrightPath), 'playwright-core/browsers.json'), 'utf8')).browsers.find(browser => browser.name === 'chromium').browserVersion;
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import App from ${JSON.stringify(path.join(app, 'components/audio-call-page-content.tsx'))};
const NativeAudioContext=window.AudioContext;window.contexts=[];window.sockets=[];window.probeStreams=[];
const nativeCapture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{const stream=await nativeCapture(...args);window.probeStreams.push(stream);return stream};
window.AudioContext=class extends NativeAudioContext{constructor(options){super(options);window.contexts.push(this)}};
window.WebSocket=class {static OPEN=1;static CLOSED=3;constructor(url){this.url=url;this.readyState=0;window.sockets.push(this);setTimeout(()=>{this.readyState=1;this.onopen?.({})},0)}send(data){(this.messages||=[]).push(data)}close(){this.readyState=3;this.onclose?.({code:1000,reason:'controlledclose'})}};
window.ParamsContext=React.createContext(new URLSearchParams('notification_text=first'));
function Harness(){const[params,setParams]=React.useState(new URLSearchParams('notification_text=first'));window.setProbeParams=(query)=>setParams(new URLSearchParams(query));return <window.ParamsContext.Provider value={params}><App/></window.ParamsContext.Provider>}
window.probeRoot=createRoot(document.getElementById('root'));window.probeRoot.render(<Harness/>);`;
(async () => {
    const result = await esbuild.build({ stdin: { contents: entry, resolveDir: app, loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', nodePaths: [path.join(app, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_BACKEND_URL': 'undefined' }, plugins: [{ name: 'controlled-ui-and-routing', setup(build) {
                    build.onResolve({ filter: /^next\/(navigation|link)$/ }, a => ({ path: a.path, namespace: 'stub' }));
                    build.onResolve({ filter: /^(?:@\/components\/|\.\/(?:appointment-scheduler|agent-execution-confirmation-notification))/ }, a => ({ path: a.path, namespace: 'stub' }));
                    build.onResolve({ filter: /^@\/lib\// }, a => ({ path: path.join(app, a.path.slice(2) + '.ts') }));
                    build.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ loader: 'tsx', resolveDir: app, contents: a.path === 'next/navigation' ? `import React from 'react';export function useSearchParams(){return React.useContext(window.ParamsContext)}` : a.path === 'next/link' ? `import React from 'react';export default function Link({children}){return <span>{children}</span>}` : `export const AudioCallInterface=()=>null,AppointmentScheduler=()=>null,MobileNotification=()=>null,AgentStatus=()=>null,HistoryMenu=()=>null,ProfileMenu=()=>null;export default ()=>null;` }));
                } }] });
    const js = result.outputFiles[0].contents;
    const server = http.createServer((req, res) => { if (req.url === '/bundle.js') {
        res.setHeader('content-type', 'application/javascript');
        return res.end(js);
    } if (['/audio/pcm-player.js', '/audio/pcm-recorder.js'].includes(req.url)) {
        const file = path.join(app, 'public', req.url);
        res.setHeader('content-type', 'application/javascript');
        return res.end(fs.readFileSync(file));
    } res.setHeader('content-type', 'text/html'); res.end('<!doctype html><div id="root"></div><script src="/bundle.js"></script>'); });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ ...(browserChannel ? { channel: browserChannel } : {}), headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
        if (!browserChannel) assert.equal(await browser.version(), expectedBrowser, 'Use the exact Chromium version pinned by Playwright');
        const context = await browser.newContext({ permissions: ['microphone'] });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(url);
        await page.getByRole('button', { name: 'Start audio conversation' }).click();
        await page.waitForFunction(() => window.sockets.length === 1 && window.contexts.length === 2 && window.contexts.every(c => c.state === 'running') && window.probeStreams.length === 1 && window.probeStreams[0].getTracks().every(t => t.readyState === 'live'));
        await page.waitForTimeout(250);
        const before = await page.evaluate(() => ({ contexts: window.contexts.map(c => ({ sampleRate: c.sampleRate, state: c.state })), sockets: window.sockets.map(s => ({ url: s.url, state: s.readyState })), alert: document.querySelector('[role=alert]')?.textContent || null }));
        assert.equal(before.alert, null);
        assert.equal(before.sockets[0].state, 1);
        await page.evaluate(() => window.setProbeParams('notification_text=second'));
        await page.waitForFunction(() => window.probeStreams.length === 2 && window.probeStreams[0].getTracks().every(t => t.readyState === 'ended') && window.probeStreams[1].getTracks().every(t => t.readyState === 'live'));
        const after = await page.evaluate(() => ({ contexts: window.contexts.map(c => ({ sampleRate: c.sampleRate, state: c.state })), sockets: window.sockets.map(s => ({ url: s.url, state: s.readyState })), alert: document.querySelector('[role=alert]')?.textContent || null }));
        const evidence = { source: app + '/components/audio-call-page-content.tsx', actualReact: require(path.join(app, 'node_modules/react/package.json')).version, actualBrowser: await browser.version(), boundary: 'Actual component/React/browser AudioContext/worklets/fake microphone; only routing/UI siblings and websocket transport controlled. No model/backend call.', before, after, errors };
        assert.equal(after.alert, null, 'notification reconnect must preserve active contexts');
        assert.equal(after.contexts.length, 2);
        assert.ok(after.contexts.every(c => c.state === 'running'));
        assert.equal(after.sockets.length, 2);
        assert.equal(after.sockets[0].state, 3);
        assert.equal(after.sockets[1].state, 1);
        assert.ok(after.sockets[1].url.endsWith('notification_text=second'));
        await page.evaluate(() => window.sockets.at(-1).close());
        await page.waitForTimeout(150);
        evidence.afterSessionStop = await page.evaluate(() => ({ contexts: window.contexts.map(c => c.state), sockets: window.sockets.map(s => s.readyState), tracks: window.probeStreams.flatMap(s => s.getTracks().map(t => t.readyState)), alert: document.querySelector('[role=alert]')?.textContent || null }));
        assert.ok(evidence.afterSessionStop.contexts.every(s => s === 'closed'));
        assert.ok(evidence.afterSessionStop.tracks.every(s => s === 'ended'));
        assert.ok(evidence.afterSessionStop.alert.includes('Retry'));
        await page.getByRole('button', { name: 'Retry audio' }).click();
        await page.waitForFunction(() => window.contexts.length === 4 && window.contexts.slice(-2).every(c => c.state === 'running') && window.sockets.at(-1).readyState === 1 && window.probeStreams.length === 3 && window.probeStreams.at(-1).getTracks().every(t => t.readyState === 'live'));
        await page.waitForTimeout(100);
        evidence.afterRetry = await page.evaluate(() => ({ contexts: window.contexts.map(c => c.state), sockets: window.sockets.map(s => s.readyState), tracks: window.probeStreams.flatMap(s => s.getTracks().map(t => t.readyState)), alert: document.querySelector('[role=alert]')?.textContent || null }));
        assert.equal(evidence.afterRetry.alert, null);
        await page.evaluate(() => window.probeRoot.unmount());
        await page.waitForTimeout(100);
        evidence.afterUnmount = await page.evaluate(() => ({ contexts: window.contexts.map(c => c.state), sockets: window.sockets.map(s => s.readyState), tracks: window.probeStreams.flatMap(s => s.getTracks().map(t => t.readyState)) }));
        assert.ok(evidence.afterUnmount.contexts.every(s => s === 'closed'));
        assert.ok(evidence.afterUnmount.tracks.every(s => s === 'ended'));
        assert.ok(evidence.afterUnmount.sockets.every(s => s === 3));
        assert.deepEqual(errors, []);
        evidence.status = 'PASS';
        if (process.env.AUDIO_TEST_RESULT)
            fs.writeFileSync(process.env.AUDIO_TEST_RESULT, JSON.stringify(evidence, null, 2) + '\n');
        console.log(JSON.stringify(evidence, null, 2));
    }
    finally {
        if (browser)
            await browser.close();
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
