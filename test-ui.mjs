import fs from 'node:fs/promises';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let targets;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    targets = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
    if (targets.length) break;
  } catch {}
  await sleep(250);
}
if (!targets?.length) throw new Error('Chromium CDP endpoint not ready');

const target = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1:4173')) || targets[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await sleep(800);

const initial = await evaluate(`({
  title: document.title,
  checkboxCount: document.querySelectorAll('input[type="checkbox"][data-id]').length,
  done: document.getElementById('doneCount').textContent,
  percent: document.getElementById('percent').textContent,
  manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
  sections: [...document.querySelectorAll('[data-section]')].map(s => s.querySelector('.section-count').textContent)
})`);

await evaluate(`document.querySelector('input[data-id="interfoni"]').click()`);
await sleep(200);
const afterClick = await evaluate(`({
  checked: document.querySelector('input[data-id="interfoni"]').checked,
  done: document.getElementById('doneCount').textContent,
  percent: document.getElementById('percent').textContent,
  saved: JSON.parse(localStorage.getItem('campeggio-checklist-v1')).interfoni
})`);

await evaluate(`Promise.race([
  navigator.serviceWorker.ready.then(() => true),
  new Promise(resolve => setTimeout(() => resolve(false), 5000))
])`);
await send('Page.reload', { ignoreCache: true });
await sleep(900);
const afterReload = await evaluate(`({
  checked: document.querySelector('input[data-id="interfoni"]').checked,
  done: document.getElementById('doneCount').textContent,
  controller: Boolean(navigator.serviceWorker.controller)
})`);

await send('Network.enable');
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
  connectionType: 'none'
});
await send('Page.reload', { ignoreCache: false });
await sleep(900);
const offlineReload = await evaluate(`({
  title: document.title,
  loaded: document.querySelectorAll('input[type="checkbox"][data-id]').length,
  controller: Boolean(navigator.serviceWorker.controller)
})`);
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
  connectionType: 'wifi'
});

await evaluate(`localStorage.removeItem('campeggio-checklist-v1'); localStorage.removeItem('campeggio-checklist-v1-updated')`);
await send('Page.reload', { ignoreCache: true });
await sleep(700);
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
await fs.writeFile('/opt/data/campeggio-checklist/preview.png', Buffer.from(screenshot.data, 'base64'));

console.log(JSON.stringify({ initial, afterClick, afterReload, offlineReload, screenshot: '/opt/data/campeggio-checklist/preview.png' }, null, 2));
ws.close();
