#!/usr/bin/env node
/**
 * Record the ?tour demo as a 1920x1080 landscape video without screen-capture
 * permission: launch a separate Chrome (temporary profile) with remote
 * debugging, pin the page viewport to 1920x1080, play the tour and collect
 * DevTools screencast frames with their timestamps. tools/record_tour.sh
 * then turns the frames into an MP4.
 *
 *   node tools/record_tour.mjs <outDir> [url]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] || 'tour_frames';
const URL = process.argv[3] || 'http://localhost:8123/?tour';
const PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, '..', 'chrome-rec-profile')}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1600,940', '--window-position=0,0',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
  '--new-window', 'about:blank',
], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map(), handlers = {};
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evalJS = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true })).result?.value;

(async () => {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); }
    catch { await sleep(500); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result || {}); pending.delete(m.id); }
    else if (m.method && handlers[m.method]) handlers[m.method](m.params);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });

  console.log('waiting for the game to load…');
  for (let i = 0; i < 180; i++) {
    if (await evalJS('!!window.__mars && document.getElementById("loading")?.classList.contains("ready")')) break;
    await sleep(1000);
  }
  await sleep(1500);

  const frames = [];
  let recording = false;
  handlers['Page.screencastFrame'] = p => {
    send('Page.screencastFrameAck', { sessionId: p.sessionId });
    if (!recording) return;
    const n = frames.length;
    const f = join(OUT, `f${String(n).padStart(6, '0')}.jpg`);
    writeFileSync(f, Buffer.from(p.data, 'base64'));
    frames.push({ f, t: p.metadata.timestamp });
  };
  await send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

  console.log('starting tour');
  await evalJS('document.getElementById("startBtn").click()');
  // record from the first shot (after the film and wake-up are skipped)
  for (let i = 0; i < 120 && !(await evalJS('!!window.__tourT0')); i++) await sleep(250);
  recording = true;
  const t0 = Date.now();
  for (let i = 0; i < 400 && !(await evalJS('!!window.__tourDone')); i++) {
    await sleep(1000);
    if (i % 10 === 0) console.log(`  ${(Date.now() - t0) / 1000 | 0} s, ${frames.length} frames`);
  }
  await sleep(1500);
  recording = false;
  await send('Page.stopScreencast');
  writeFileSync(join(OUT, 'frames.json'), JSON.stringify(frames));
  console.log(`DONE ${frames.length} frames over ${(frames.at(-1).t - frames[0].t).toFixed(1)} s`);
  chrome.kill();
  process.exit(0);
})().catch(e => { console.error(e); chrome.kill(); process.exit(1); });
