(() => {
  'use strict';

  const STORAGE_KEY = 'campeggio-checklist-v2';
  const LEGACY_STORAGE_KEY = 'campeggio-checklist-v1';
  const UPDATED_KEY = `${STORAGE_KEY}-updated`;

  const DEFAULT_CATEGORIES = [
    {
      id: 'electronics',
      name: 'Caschi ed elettronica',
      icon: '🎧',
      items: [
        { id: 'interfoni', text: 'Caricare gli interfoni nei caschi' },
        { id: 'elettronica', text: 'Caricare cellulare, power bank e altri dispositivi' }
      ]
    },
    {
      id: 'barbecue',
      name: 'Carne e barbecue',
      icon: '🔥',
      items: [
        { id: 'carne', text: 'Carne e alimenti da cucinare' },
        { id: 'grill', text: 'Barbecue usa e getta Big Jeff', note: 'Sono già pronti: non servono altro carbone o cubetti accendifuoco.' },
        { id: 'accendino', text: 'Accendino lungo o fiammiferi lunghi' },
        { id: 'pinza', text: 'Pinza da cucina' },
        { id: 'guanto', text: 'Guanto termico' },
        { id: 'acqua-spegnimento', text: 'Acqua dedicata allo spegnimento' },
        { id: 'permesso-fuoco', text: 'Verificare che il campeggio permetta barbecue e fiamme' }
      ]
    },
    {
      id: 'trekking',
      name: 'Zainetto trekking',
      icon: '🥾',
      items: [
        { id: 'acqua', text: 'Riempire la sacca con 1–1,5 litri d’acqua' },
        { id: 'perdite', text: 'Controllare che sacca, tappo e tubo non perdano' },
        { id: 'telefono-zaino', text: 'Telefono, power bank e cavetto' },
        { id: 'wikiloc', text: 'Percorso Wikiloc disponibile offline' },
        { id: 'mappa-offline', text: 'Mappa della zona scaricata offline' },
        { id: 'gps-test', text: 'Verificare che il GPS mostri correttamente la posizione' },
        { id: 'snack', text: 'Uno snack leggero' },
        { id: 'rifiuti', text: 'Piccola busta per i rifiuti' },
        { id: 'cappellino', text: 'Cappellino' },
        { id: 'occhiali', text: 'Occhiali da sole' },
        { id: 'crema', text: 'Crema solare' },
        { id: 'giacca', text: 'Giacca leggera, antivento o impermeabile compatto' },
        { id: 'soccorso', text: 'Mini kit di primo soccorso e cerotto per vesciche' },
        { id: 'farmaci', text: 'Medicinali personali' },
        { id: 'documenti', text: 'Documenti, chiavi e fazzoletti' },
        { id: 'torcia', text: 'Torcia frontale', note: 'Solo se c’è il rischio di rientrare tardi.' },
        { id: 'condivisione', text: 'Condividere percorso e orario di rientro con qualcuno' }
      ]
    }
  ];

  const progress = document.getElementById('progress');
  const progressCard = document.getElementById('progressCard');
  const doneCount = document.getElementById('doneCount');
  const totalCount = document.getElementById('totalCount');
  const percent = document.getElementById('percent');
  const networkStatus = document.getElementById('networkStatus');
  const categoriesContainer = document.getElementById('categories');
  const editorDialog = document.getElementById('editorDialog');
  const editorForm = document.getElementById('editorForm');
  const editorTitle = document.getElementById('editorTitle');
  const editorNameLabel = document.getElementById('editorNameLabel');
  const editorName = document.getElementById('editorName');
  const editorIconField = document.getElementById('editorIconField');
  const editorIcon = document.getElementById('editorIcon');
  const editorError = document.getElementById('editorError');

  let state;
  let editorMode = 'category';
  let editorCategoryId = null;

  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

  const cloneDefaults = () => JSON.parse(JSON.stringify({ version: 2, categories: DEFAULT_CATEGORIES }));

  const readStorage = key => {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  };

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(UPDATED_KEY, new Date().toISOString());
    } catch {
      // localStorage can be unavailable in private browsing; the checklist remains usable for this visit.
    }
  };

  const newId = (prefix, usedIds) => {
    let id;
    do {
      const randomId = globalThis.crypto?.randomUUID?.();
      id = `${prefix}-${randomId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  const normalizeState = raw => {
    if (!isRecord(raw) || !Array.isArray(raw.categories)) return null;

    const usedCategoryIds = new Set();
    const usedItemIds = new Set();
    const categories = raw.categories.flatMap(rawCategory => {
      if (!isRecord(rawCategory)) return [];
      const name = typeof rawCategory.name === 'string' ? rawCategory.name.trim().slice(0, 120) : '';
      if (!name) return [];
      let categoryId = typeof rawCategory.id === 'string' && rawCategory.id.trim() ? rawCategory.id.trim() : '';
      if (!categoryId || usedCategoryIds.has(categoryId)) categoryId = newId('category', usedCategoryIds);
      else usedCategoryIds.add(categoryId);

      const items = Array.isArray(rawCategory.items) ? rawCategory.items.flatMap(rawItem => {
        if (!isRecord(rawItem)) return [];
        const text = typeof rawItem.text === 'string' ? rawItem.text.trim().slice(0, 160) : '';
        if (!text) return [];
        let itemId = typeof rawItem.id === 'string' && rawItem.id.trim() ? rawItem.id.trim() : '';
        if (!itemId || usedItemIds.has(itemId)) itemId = newId('item', usedItemIds);
        else usedItemIds.add(itemId);
        const item = { id: itemId, text, checked: rawItem.checked === true };
        if (typeof rawItem.note === 'string' && rawItem.note.trim()) item.note = rawItem.note.trim().slice(0, 240);
        return [item];
      }) : [];

      return [{
        id: categoryId,
        name,
        icon: typeof rawCategory.icon === 'string' && rawCategory.icon.trim() ? rawCategory.icon.trim().slice(0, 8) : '⛺',
        items
      }];
    });

    return { version: 2, categories };
  };

  const migrateLegacyState = () => {
    const legacy = readStorage(LEGACY_STORAGE_KEY);
    if (!isRecord(legacy)) return null;
    const migrated = cloneDefaults();
    migrated.categories.forEach(category => category.items.forEach(item => {
      item.checked = legacy[item.id] === true;
    }));
    return migrated;
  };

  const loadState = () => {
    const saved = normalizeState(readStorage(STORAGE_KEY));
    if (saved) return saved;

    const migrated = migrateLegacyState();
    if (migrated) {
      state = migrated;
      saveState();
      return migrated;
    }

    const defaults = cloneDefaults();
    state = defaults;
    saveState();
    return defaults;
  };

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const getCategory = categoryId => state.categories.find(category => category.id === categoryId);

  const renderCategory = category => {
    const section = createElement('section', 'section');
    section.dataset.section = '';
    section.dataset.categoryId = category.id;

    const head = createElement('div', 'section-head');
    const title = createElement('h2', 'section-title');
    const icon = createElement('span', 'section-icon', category.icon);
    const name = createElement('span', 'section-name', category.name);
    title.append(icon, name);

    const actions = createElement('div', 'section-actions');
    const addItemButton = createElement('button', 'section-btn', 'Aggiungi elemento');
    addItemButton.type = 'button';
    addItemButton.dataset.action = 'add-item';
    addItemButton.dataset.categoryId = category.id;
    addItemButton.setAttribute('aria-label', `Aggiungi elemento a ${category.name}`);
    const deleteCategoryButton = createElement('button', 'section-btn danger', 'Elimina categoria');
    deleteCategoryButton.type = 'button';
    deleteCategoryButton.dataset.action = 'delete-category';
    deleteCategoryButton.dataset.categoryId = category.id;
    deleteCategoryButton.setAttribute('aria-label', `Elimina la categoria ${category.name}`);
    actions.append(addItemButton, deleteCategoryButton);

    const count = createElement('span', 'section-count');
    count.dataset.sectionCount = '';
    const completedItems = category.items.filter(item => item.checked).length;
    count.textContent = `${completedItems}/${category.items.length}`;
    head.append(title, actions, count);

    const items = createElement('div', 'items');
    category.items.forEach(item => {
      const row = createElement('div', 'item');
      row.dataset.itemId = item.id;
      row.dataset.categoryId = category.id;

      const itemLabel = createElement('label', 'item-check');
      const checkbox = createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.id = item.id;
      checkbox.checked = item.checked === true;
      checkbox.setAttribute('aria-label', item.text);
      const itemText = createElement('span', 'item-text');
      itemText.append(createElement('span', '', item.text));
      if (item.note) itemText.append(createElement('span', 'item-note', item.note));
      itemLabel.append(checkbox, itemText);

      const deleteItemButton = createElement('button', 'section-btn danger delete-item', '×');
      deleteItemButton.type = 'button';
      deleteItemButton.dataset.action = 'delete-item';
      deleteItemButton.dataset.categoryId = category.id;
      deleteItemButton.dataset.itemId = item.id;
      deleteItemButton.setAttribute('aria-label', `Elimina l'elemento ${item.text}`);
      deleteItemButton.title = 'Elimina elemento';
      row.append(itemLabel, deleteItemButton);
      items.append(row);
    });
    if (!category.items.length) items.append(createElement('p', 'empty', 'Nessun elemento. Aggiungine uno per iniziare.'));

    section.append(head, items);
    return section;
  };

  const render = () => {
    categoriesContainer.replaceChildren(...state.categories.map(renderCategory));
    const allItems = state.categories.flatMap(category => category.items);
    const completed = allItems.filter(item => item.checked).length;
    const value = allItems.length ? Math.round((completed / allItems.length) * 100) : 0;
    doneCount.textContent = completed;
    totalCount.textContent = allItems.length;
    percent.textContent = `${value}%`;
    progress.value = value;

    if (completed === allItems.length && allItems.length) {
      progressCard.classList.remove('celebrate');
      requestAnimationFrame(() => progressCard.classList.add('celebrate'));
    }
  };

  const closeEditor = () => {
    editorError.textContent = '';
    editorForm.reset();
    editorDialog.close();
  };

  const openEditor = (mode, categoryId = null) => {
    editorMode = mode;
    editorCategoryId = categoryId;
    const isCategory = mode === 'category';
    editorTitle.textContent = isCategory ? 'Nuova categoria' : 'Nuovo elemento';
    editorNameLabel.textContent = isCategory ? 'Nome categoria' : 'Nome elemento';
    editorIconField.hidden = !isCategory;
    editorIcon.value = '';
    editorName.value = '';
    editorError.textContent = '';
    editorDialog.showModal();
    editorName.focus();
  };

  const removeItem = (categoryId, itemId) => {
    const category = getCategory(categoryId);
    const itemIndex = category?.items.findIndex(item => item.id === itemId) ?? -1;
    if (!category || itemIndex < 0) return;
    const item = category.items[itemIndex];
    if (!confirm(`Eliminare l'elemento "${item.text}"? La sua spunta verrà persa.`)) {
      return;
    }
    category.items.splice(itemIndex, 1);
    saveState();
    render();
  };

  const removeCategory = categoryId => {
    const categoryIndex = state.categories.findIndex(category => category.id === categoryId);
    if (categoryIndex < 0) return;
    const category = state.categories[categoryIndex];
    const itemLabel = category.items.length === 1 ? '1 elemento' : `${category.items.length} elementi`;
    if (!confirm(`Eliminare la categoria "${category.name}"? Verranno persi ${itemLabel} e tutte le relative spunte.`)) return;
    state.categories.splice(categoryIndex, 1);
    saveState();
    render();
  };

  categoriesContainer.addEventListener('change', event => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || !checkbox.matches('input[type="checkbox"][data-id]')) return;
    const row = checkbox.closest('[data-item-id]');
    const category = row ? getCategory(row.dataset.categoryId) : null;
    const item = category?.items.find(candidate => candidate.id === row?.dataset.itemId);
    if (!item) return;
    item.checked = checkbox.checked;
    saveState();
    render();
  });

  categoriesContainer.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button[data-action]');
    if (!button) return;
    event.preventDefault();
    const { action, categoryId, itemId } = button.dataset;
    if (action === 'add-item') openEditor('item', categoryId);
    if (action === 'delete-item') removeItem(categoryId, itemId);
    if (action === 'delete-category') removeCategory(categoryId);
  });

  editorForm.addEventListener('submit', event => {
    event.preventDefault();
    const name = editorName.value.trim();
    if (!name) {
      editorError.textContent = 'Inserisci un nome prima di salvare.';
      editorName.focus();
      return;
    }

    if (editorMode === 'category') {
      const usedIds = new Set(state.categories.map(category => category.id));
      state.categories.push({
        id: newId('category', usedIds),
        name,
        icon: editorIcon.value.trim() || '⛺',
        items: []
      });
    } else {
      const category = getCategory(editorCategoryId);
      if (!category) {
        closeEditor();
        return;
      }
      const usedIds = new Set(state.categories.flatMap(candidate => candidate.items.map(item => item.id)));
      category.items.push({ id: newId('item', usedIds), text: name, checked: false });
    }

    saveState();
    closeEditor();
    render();
  });

  document.getElementById('editorCancel').addEventListener('click', closeEditor);
  document.getElementById('newCategory').addEventListener('click', () => openEditor('category'));

  document.getElementById('completeAll').addEventListener('click', () => {
    state.categories.forEach(category => category.items.forEach(item => { item.checked = true; }));
    saveState();
    render();
  });

  document.getElementById('resetAll').addEventListener('click', () => {
    if (!confirm('Vuoi davvero togliere tutte le spunte?')) return;
    state.categories.forEach(category => category.items.forEach(item => { item.checked = false; }));
    saveState();
    render();
  });

  document.getElementById('sharePage').addEventListener('click', async () => {
    const data = { title: document.title, text: 'Checklist campeggio', url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(location.href);
        alert('Link copiato!');
      }
    } catch (error) {
      if (error.name !== 'AbortError') prompt('Copia questo link:', location.href);
    }
  });

  const updateNetwork = () => {
    const online = navigator.onLine;
    networkStatus.textContent = online ? 'Online' : 'Offline';
    networkStatus.classList.toggle('offline', !online);
  };

  state = loadState();
  updateNetwork();
  addEventListener('online', updateNetwork);
  addEventListener('offline', updateNetwork);
  render();

  if ('serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
