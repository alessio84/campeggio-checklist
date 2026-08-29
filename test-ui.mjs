import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let targets;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    targets = await fetch('http://127.0.0.1:9223/json/list').then(response => response.json());
    if (targets.length) break;
  } catch {}
  await sleep(250);
}
if (!targets?.length) throw new Error('Chromium CDP endpoint not ready');

const target = targets.find(item => item.type === 'page' && item.url.includes('127.0.0.1:4173')) || targets[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails?.text || 'Runtime exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) {
    runtimeErrors.push(`console.${message.params.type}`);
  }
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result.value;
};

const [appSource, htmlSource] = await Promise.all([
  fs.readFile('/opt/data/campeggio-checklist/app.js', 'utf8'),
  fs.readFile('/opt/data/campeggio-checklist/index.html', 'utf8')
]);
for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
  assert.equal(appSource.includes(sink) || htmlSource.includes(sink), false, `unsafe sink found: ${sink}`);
}

const reload = async () => {
  await send('Page.reload', { ignoreCache: true });
  await sleep(700);
};

const snapshot = () => evaluate(`({
  title: document.title,
  checkboxCount: document.querySelectorAll('input[type="checkbox"][data-id]').length,
  done: document.getElementById('doneCount').textContent,
  total: document.getElementById('totalCount').textContent,
  percent: document.getElementById('percent').textContent,
  manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
  categories: [...document.querySelectorAll('[data-section]')].map(section => ({
    id: section.dataset.categoryId,
    name: section.querySelector('.section-name').textContent,
    count: section.querySelector('.section-count').textContent,
    items: [...section.querySelectorAll('.item')].map(row => ({
      id: row.dataset.itemId,
      text: row.querySelector('.item-text > span')?.textContent,
      checked: row.querySelector('input[type="checkbox"][data-id]')?.checked,
      editButton: row.querySelector('[data-action="edit-item"]')?.textContent,
      deleteButton: row.querySelector('[data-action="delete-item"]')?.textContent
    }))
  }))
})`);

const submitDialog = async ({ name, icon } = {}) => evaluate(`(() => {
  const nameInput = document.getElementById('editorName');
  nameInput.value = ${JSON.stringify(name ?? '')};
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  const iconInput = document.getElementById('editorIcon');
  if (iconInput && ${icon !== undefined}) {
    iconInput.value = ${JSON.stringify(icon)};
    iconInput.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.getElementById('editorForm').requestSubmit();
  return true;
})()`);

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true
});
await sleep(800);
const mobileGeometry = await evaluate(`({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  documentWidth: document.documentElement.scrollWidth,
  bodyWidth: document.body.scrollWidth
})`);
assert.deepEqual(mobileGeometry, { innerWidth: 390, innerHeight: 844, documentWidth: 390, bodyWidth: 390 });

await evaluate(`(async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  }
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
  return true;
})()`);
await evaluate(`localStorage.clear(); sessionStorage.clear();`);
await reload();

const migrated = await evaluate(`(() => {
  localStorage.clear();
  localStorage.setItem('campeggio-checklist-v1', JSON.stringify({ interfoni: true, grill: true }));
  return true;
})()`);
assert.equal(migrated, true);
await reload();
const afterMigration = await evaluate(`(() => {
  const state = JSON.parse(localStorage.getItem('campeggio-checklist-v2'));
  return {
    categories: state?.categories?.length,
    items: state?.categories?.reduce((total, category) => total + category.items.length, 0),
    checked: state?.categories?.flatMap(category => category.items).filter(item => item.checked).map(item => item.id),
    legacyStillAvailable: Boolean(localStorage.getItem('campeggio-checklist-v1'))
  };
})()`);
assert.deepEqual(afterMigration, {
  categories: 3,
  items: 26,
  checked: ['interfoni', 'grill'],
  legacyStillAvailable: true
});

await evaluate(`localStorage.clear()`);
await reload();
const initial = await snapshot();
assert.equal(initial.title, 'Checklist campeggio');
assert.equal(initial.checkboxCount, 26);
assert.deepEqual(initial.categories.map(category => category.count), ['0/2', '0/7', '0/17']);
assert.equal(initial.done, '0');
assert.equal(initial.total, '26');
assert.equal(initial.percent, '0%');
assert.equal(initial.manifest, 'manifest.webmanifest');
assert.ok(initial.categories.every(category => category.items.every(item => item.editButton === 'Modifica' && item.deleteButton === '×')));
assert.ok(await evaluate(`Boolean(document.getElementById('newCategory'))`));

await evaluate(`document.getElementById('newCategory').click()`);
await submitDialog({ name: '' });
assert.equal(await evaluate('document.getElementById("editorDialog").open'), true);
assert.equal(await evaluate('document.getElementById("editorError").textContent'), 'Inserisci un nome prima di salvare.');
assert.equal(await evaluate('document.getElementById("editorName").getAttribute("aria-invalid")'), 'true');
await submitDialog({ name: '   ' });
assert.equal(await evaluate('document.getElementById("editorDialog").open'), true);
assert.equal(await evaluate('document.getElementById("editorError").textContent'), 'Inserisci un nome prima di salvare.');
assert.equal(await evaluate('document.getElementById("editorName").getAttribute("aria-invalid")'), 'true');
assert.equal((await snapshot()).categories.length, 3);
await evaluate(`document.getElementById('editorCancel').click()`);

await evaluate(`document.querySelector('input[data-id="interfoni"]').click()`);
await sleep(150);
const afterBaselineCheck = await snapshot();
assert.equal(afterBaselineCheck.done, '1');
assert.equal(afterBaselineCheck.categories[0].count, '1/2');

const predefinedItemBeforeEdit = afterBaselineCheck.categories[0].items.find(item => item.id === 'interfoni');
await evaluate(`document.querySelector('[data-action="edit-item"][data-item-id="interfoni"]').click()`);
assert.equal(await evaluate('document.getElementById("editorDialog").open'), true);
assert.equal(await evaluate('document.getElementById("editorTitle").textContent'), 'Modifica elemento');
assert.equal(await evaluate('document.getElementById("editorName").value'), 'Caricare gli interfoni nei caschi');
await submitDialog({ name: 'Caricare gli interfoni nei caschi verificati' });
await sleep(150);
const afterPredefinedEdit = await snapshot();
const predefinedCategoryAfterEdit = afterPredefinedEdit.categories[0];
const predefinedItemAfterEdit = predefinedCategoryAfterEdit.items.find(item => item.id === predefinedItemBeforeEdit.id);
assert.equal(predefinedItemAfterEdit.text, 'Caricare gli interfoni nei caschi verificati');
assert.equal(predefinedItemAfterEdit.id, predefinedItemBeforeEdit.id);
assert.equal(predefinedItemAfterEdit.checked, true);
assert.equal(predefinedCategoryAfterEdit.id, afterBaselineCheck.categories[0].id);
assert.equal(predefinedCategoryAfterEdit.count, '1/2');
assert.equal(afterPredefinedEdit.total, '26');
assert.equal(afterPredefinedEdit.done, '1');
assert.equal(afterPredefinedEdit.percent, '4%');

await evaluate(`document.getElementById('newCategory').click()`);
await submitDialog({ name: 'Attrezzatura test', icon: '🧪' });
await sleep(150);
let afterCategory = await snapshot();
assert.equal(afterCategory.categories.length, 4);
assert.equal(afterCategory.categories.at(-1).name, 'Attrezzatura test');
assert.equal(afterCategory.categories.at(-1).count, '0/0');
assert.equal(afterCategory.total, '26');

await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Attrezzatura test');
  section.querySelector('[data-action="add-item"]').click();
})()`);
await submitDialog({ name: 'Lampada test' });
await sleep(150);
afterCategory = await snapshot();
const testCategory = afterCategory.categories.find(category => category.name === 'Attrezzatura test');
assert.equal(testCategory.count, '0/1');
assert.equal(afterCategory.total, '27');
assert.equal(afterCategory.categories.reduce((total, category) => total + category.items.length, 0), 27);
const createdItemBeforeEdit = testCategory.items[0];
assert.equal(createdItemBeforeEdit.text, 'Lampada test');
assert.equal(createdItemBeforeEdit.editButton, 'Modifica');
assert.equal(createdItemBeforeEdit.deleteButton, '×');

await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Attrezzatura test');
  section.querySelector('[data-action="edit-item"]').click();
})()`);
assert.equal(await evaluate('document.getElementById("editorDialog").open'), true);
assert.equal(await evaluate('document.getElementById("editorTitle").textContent'), 'Modifica elemento');
assert.equal(await evaluate('document.getElementById("editorSubmit").textContent'), 'Salva');
assert.equal(await evaluate('document.getElementById("editorName").value'), 'Lampada test');
await evaluate(`document.getElementById('editorCancel').click()`);
const afterCreatedCancel = await snapshot();
const createdItemAfterCancel = afterCreatedCancel.categories.find(category => category.name === 'Attrezzatura test').items[0];
assert.deepEqual(createdItemAfterCancel, createdItemBeforeEdit);

await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Attrezzatura test');
  section.querySelector('input[type="checkbox"]').click();
})()`);
await sleep(150);
const afterNewCheck = await snapshot();
assert.equal(afterNewCheck.done, '2');
assert.equal(afterNewCheck.total, '27');
assert.equal(afterNewCheck.categories.find(category => category.name === 'Attrezzatura test').count, '1/1');
assert.equal(afterNewCheck.percent, '7%');

await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Attrezzatura test');
  section.querySelector('[data-action="edit-item"]').click();
})()`);
await submitDialog({ name: '\t  ' });
assert.equal(await evaluate('document.getElementById("editorDialog").open'), true);
assert.equal(await evaluate('document.getElementById("editorError").textContent'), 'Inserisci un nome prima di salvare.');
const afterWhitespaceEdit = await snapshot();
const whitespaceItem = afterWhitespaceEdit.categories.find(category => category.name === 'Attrezzatura test').items[0];
assert.equal(whitespaceItem.text, 'Lampada test');
assert.equal(whitespaceItem.id, createdItemBeforeEdit.id);
assert.equal(whitespaceItem.checked, true);
await submitDialog({ name: 'Lampada test modificata' });
await sleep(150);
const afterCreatedEdit = await snapshot();
const editedCreatedCategory = afterCreatedEdit.categories.find(category => category.name === 'Attrezzatura test');
const editedCreatedItem = editedCreatedCategory.items[0];
assert.equal(editedCreatedItem.text, 'Lampada test modificata');
assert.equal(editedCreatedItem.id, createdItemBeforeEdit.id);
assert.equal(editedCreatedCategory.id, testCategory.id);
assert.equal(editedCreatedItem.checked, true);
assert.equal(editedCreatedCategory.count, '1/1');
assert.equal(afterCreatedEdit.total, '27');
assert.equal(afterCreatedEdit.done, '2');
assert.equal(afterCreatedEdit.percent, '7%');

await reload();
const afterReload = await snapshot();
assert.equal(afterReload.done, '2');
assert.equal(afterReload.total, '27');
assert.equal(afterReload.categories[0].items.find(item => item.id === predefinedItemBeforeEdit.id).text, 'Caricare gli interfoni nei caschi verificati');
assert.equal(afterReload.categories[0].items.find(item => item.id === predefinedItemBeforeEdit.id).checked, true);
const reloadedCreatedCategory = afterReload.categories.find(category => category.name === 'Attrezzatura test');
assert.equal(reloadedCreatedCategory.items[0].text, 'Lampada test modificata');
assert.equal(reloadedCreatedCategory.items[0].id, createdItemBeforeEdit.id);
assert.equal(reloadedCreatedCategory.id, editedCreatedCategory.id);
assert.equal(reloadedCreatedCategory.items[0].checked, true);
assert.equal(reloadedCreatedCategory.items[0].editButton, 'Modifica');
assert.equal(reloadedCreatedCategory.items[0].deleteButton, '×');
const persistedState = await evaluate(`JSON.parse(localStorage.getItem('campeggio-checklist-v2'))`);
assert.equal(persistedState.version, 2);
assert.equal(persistedState.categories.length, 4);
const persistedCreatedCategory = persistedState.categories.find(category => category.id === editedCreatedCategory.id);
assert.equal(persistedCreatedCategory.name, 'Attrezzatura test');
assert.equal(persistedCreatedCategory.items[0].text, 'Lampada test modificata');
assert.equal(persistedCreatedCategory.items[0].id, createdItemBeforeEdit.id);
assert.equal(persistedCreatedCategory.items[0].checked, true);
const persistedPredefinedItem = persistedState.categories[0].items.find(item => item.id === predefinedItemBeforeEdit.id);
assert.equal(persistedPredefinedItem.text, 'Caricare gli interfoni nei caschi verificati');
assert.equal(persistedPredefinedItem.checked, true);

const confirmMessages = [];
await evaluate(`window.confirm = message => { window.__lastConfirm = message; return true; }`);
await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Attrezzatura test');
  section.querySelector('[data-action="delete-item"]').click();
})()`);
await sleep(150);
const afterItemDelete = await snapshot();
assert.equal(afterItemDelete.total, '26');
assert.equal(afterItemDelete.done, '1');
assert.equal(afterItemDelete.categories.find(category => category.name === 'Attrezzatura test').count, '0/0');
confirmMessages.push(await evaluate('window.__lastConfirm'));
assert.match(confirmMessages[0], /Lampada test/);

await evaluate(`document.getElementById('newCategory').click()`);
await submitDialog({ name: 'Categoria da eliminare', icon: '🗑️' });
await sleep(100);
await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Categoria da eliminare');
  section.querySelector('[data-action="add-item"]').click();
})()`);
await submitDialog({ name: 'Elemento da perdere' });
await sleep(100);
await evaluate(`(() => {
  const section = [...document.querySelectorAll('[data-section]')].find(item => item.querySelector('.section-name').textContent === 'Categoria da eliminare');
  section.querySelector('[data-action="delete-category"]').click();
})()`);
await sleep(150);
const afterCategoryDelete = await snapshot();
assert.equal(afterCategoryDelete.categories.length, 4);
assert.equal(afterCategoryDelete.total, '26');
assert.equal(afterCategoryDelete.done, '1');
const categoryDeleteMessage = await evaluate('window.__lastConfirm');
assert.match(categoryDeleteMessage, /Categoria da eliminare/);
assert.match(categoryDeleteMessage, /1 elemento/);
assert.match(categoryDeleteMessage, /persi|perder/);

await evaluate(`document.getElementById('completeAll').click()`);
await sleep(100);
const afterCompleteAll = await snapshot();
assert.equal(afterCompleteAll.done, '26');
assert.equal(afterCompleteAll.total, '26');
assert.equal(afterCompleteAll.percent, '100%');
await evaluate(`document.getElementById('resetAll').click()`);
await sleep(100);
const afterReset = await snapshot();
assert.equal(afterReset.done, '0');
assert.equal(afterReset.percent, '0%');
assert.match(await evaluate('window.__lastConfirm'), /togliere tutte le spunte/);
await evaluate(`document.querySelector('input[data-id="interfoni"]').click()`);
await sleep(100);

await evaluate(`localStorage.removeItem('campeggio-checklist-v1')`);
await evaluate(`navigator.serviceWorker.ready.then(() => true)`);
await reload();
if (!await evaluate('Boolean(navigator.serviceWorker.controller)')) {
  await send('Page.reload', { ignoreCache: false });
  await sleep(1000);
}
const controller = await evaluate('Boolean(navigator.serviceWorker.controller)');
assert.equal(controller, true);
assert.ok((await evaluate('caches.keys()')).includes('campeggio-checklist-v4'));
await send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: 0,
  uploadThroughput: 0,
  connectionType: 'none'
});
await send('Page.reload', { ignoreCache: false });
await sleep(900);
const offlineReload = await snapshot();
assert.equal(offlineReload.title, 'Checklist campeggio');
assert.equal(offlineReload.checkboxCount, 26);
assert.equal(await evaluate('Boolean(navigator.serviceWorker.controller)'), true);
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
  connectionType: 'wifi'
});

await evaluate(`localStorage.clear(); sessionStorage.clear()`);
await reload();
const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
await fs.writeFile('/opt/data/campeggio-checklist/preview.png', Buffer.from(screenshot.data, 'base64'));
assert.deepEqual(runtimeErrors, []);
console.log(JSON.stringify({ initial, afterMigration, afterReload, afterItemDelete, afterCategoryDelete, offlineReload, runtimeErrors, screenshot: '/opt/data/campeggio-checklist/preview.png' }, null, 2));
ws.close();
