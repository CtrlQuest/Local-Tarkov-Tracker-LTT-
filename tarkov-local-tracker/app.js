const STORAGE_KEY = 'local-raid-tracker-v9';
const LEGACY_STORAGE_KEYS = ['local-raid-tracker-v8','local-raid-tracker-v7','local-raid-tracker-v6','local-raid-tracker-v5','local-raid-tracker-v4','local-raid-tracker-v3','local-raid-tracker-v2','local-raid-tracker-v1'];
const API_URL = 'https://api.tarkov.dev/graphql';

const starterItems = [
  { id: crypto.randomUUID(), name: 'Toolset', needed: 3, found: 0, source: 'custom', note: 'Example manual track' },
  { id: crypto.randomUUID(), name: 'Salewa first aid kit', needed: 3, found: 0, source: 'quest', note: 'Starter example' },
  { id: crypto.randomUUID(), name: 'Gas analyzer', needed: 2, found: 0, source: 'quest', note: 'Starter example' },
  { id: crypto.randomUUID(), name: 'Flash drive', needed: 2, found: 0, source: 'quest', note: 'Starter example' },
  { id: crypto.randomUUID(), name: 'Car battery', needed: 4, found: 0, source: 'hideout', note: 'Starter example' },
  { id: crypto.randomUUID(), name: 'Corrugated hose', needed: 6, found: 0, source: 'hideout', note: 'Starter example' }
];

let state = loadState();
let activeMap = null;

function defaultState() {
  return {
    items: [],
    tracked: [],
    raidBag: {},
    apiCache: { maps: FALLBACK_MAPS, keys: FALLBACK_KEYS, tasks: FALLBACK_TASKS, syncedAt: null, source: 'offline fallback' },
    mapImages: {},
    mapAssetChoice: {},
    keyLocker: {},
    missionProgress: {},
    taskObjectives: {},
    storyProgress: {},
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    const parsed = saved ? JSON.parse(saved) : {};
    return { ...defaultState(), ...parsed, apiCache: { ...defaultState().apiCache, ...(parsed.apiCache || {}) }, keyLocker: parsed.keyLocker || {}, missionProgress: parsed.missionProgress || {}, taskObjectives: parsed.taskObjectives || {}, storyProgress: parsed.storyProgress || {}, mapImages: parsed.mapImages || {}, mapAssetChoice: parsed.mapAssetChoice || {} };
  } catch {
    return defaultState();
  }
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function $(id) { return document.getElementById(id); }
function escapeHtml(str) { return String(str ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function slugify(str) { return String(str || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function normalizeMapId(str) {
  const s = slugify(str || '');
  const aliases = {
    laboratory: 'the-lab', labs: 'the-lab', lab: 'the-lab', 'the-laboratory': 'the-lab',
    streets: 'streets-of-tarkov', 'streets-of-tarkov': 'streets-of-tarkov',
    groundzero: 'ground-zero', 'ground-zero': 'ground-zero',
    labyrinth: 'the-labyrinth', 'the-labyrinth': 'the-labyrinth'
  };
  return aliases[s] || s;
}
function mapMeta(nameOrSlug) {
  const wanted = normalizeMapId(nameOrSlug);
  return MAP_LINKS.find(m => normalizeMapId(m.slug) === wanted || normalizeMapId(m.name) === wanted) || null;
}
function mapLink(nameOrSlug) { const meta = mapMeta(nameOrSlug); return `https://tarkov.dev/map/${meta?.slug || normalizeMapId(nameOrSlug)}`; }
function wikiMapLink(nameOrSlug, fallback) { return mapMeta(nameOrSlug)?.wikiMap || fallback || '#'; }
function itemProgress(item) { return Math.min(Number(item.found || 0), Number(item.needed || 0)); }
function mergedMaps() {
  const byId = new Map();
  const add = (m) => {
    if (!m || !m.name) return;
    const id = normalizeMapId(m.normalizedName || m.id || m.name);
    const old = byId.get(id) || {};
    byId.set(id, { ...old, ...m, id: m.id || old.id || id, normalizedName: id, name: m.name || old.name });
  };
  FALLBACK_MAPS.forEach(add);
  (state.apiCache.maps || []).forEach(add);
  MAP_LINKS.forEach(m => add({ id: m.slug, normalizedName: m.slug, name: m.name, wiki: m.wikiMap, extracts: [], keys: [], notes: 'Interactive map link included. Sync public data for extracts/locks when available.' }));
  (MAP_ASSETS || []).forEach(a => add({ id: a.mapId, normalizedName: a.mapId, name: (MAP_LINKS.find(m => normalizeMapId(m.slug) === normalizeMapId(a.mapId))?.name || a.mapId), extracts: [], keys: [], notes: 'Local map image pack included.' }));
  return [...byId.values()].sort((a,b) => a.name.localeCompare(b.name));
}

function toast(message) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function renderStats() {
  const totalNeeded = state.items.reduce((sum, i) => sum + Number(i.needed || 0), 0);
  const totalFound = state.items.reduce((sum, i) => sum + itemProgress(i), 0);
  const trackedCount = state.tracked.length;
  const raidCount = Object.values(state.raidBag || {}).reduce((sum, qty) => sum + qty, 0);
  const ownedKeys = Object.values(state.keyLocker || {}).filter(k => k.status === 'owned').length;
  const needKeys = Object.values(state.keyLocker || {}).filter(k => k.status === 'needed').length;
  const missionCount = Object.values(state.missionProgress || {}).filter(v => v === 'complete').length;
  const synced = state.apiCache.syncedAt ? new Date(state.apiCache.syncedAt).toLocaleString() : 'Not synced';
  $('stats').innerHTML = [
    ['Progress', `${totalFound}/${totalNeeded}`],
    ['Tracked', trackedCount],
    ['Raid Bag', raidCount],
    ['Keys owned', ownedKeys],
    ['Keys needed', needKeys],
    ['Missions done', missionCount],
    ['Tarkov data', synced]
  ].map(([label, value]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function renderTrackedList() {
  const trackedItems = state.tracked.map(id => state.items.find(i => i.id === id)).filter(Boolean).slice(0, 12);
  $('trackedList').innerHTML = trackedItems.length ? trackedItems.map(i => `
    <div class="mini-row">
      <div><strong>${escapeHtml(i.name)}</strong><br><span>${itemProgress(i)} / ${i.needed} • ${escapeHtml(i.note || i.source)}</span></div>
      <button onclick="addRaidFound('${i.id}')">Found</button>
    </div>`).join('') : '<p>No tracked items yet.</p>';

  const bag = Object.entries(state.raidBag || {}).filter(([,qty]) => qty > 0);
  $('raidBagMini').innerHTML = bag.length ? bag.map(([id, qty]) => {
    const i = state.items.find(x => x.id === id);
    return `<div class="mini-row"><div><strong>${escapeHtml(i?.name || 'Unknown')}</strong><br><span>Temporary: ${qty}</span></div></div>`;
  }).join('') : '<p>Raid bag empty.</p>';
}

function renderItems() {
  const search = ($('searchInput')?.value || '').trim().toLowerCase();
  const filter = $('filterSelect')?.value || 'all';
  const list = $('itemList');
  if (!list) return;
  const template = $('itemTemplate');
  list.innerHTML = '';

  const filtered = state.items.filter(item => {
    const text = `${item.name} ${item.source} ${item.note}`.toLowerCase();
    const matchesSearch = !search || text.includes(search);
    const isTracked = state.tracked.includes(item.id);
    const unfinished = Number(item.found || 0) < Number(item.needed || 0);
    const matchesFilter = filter === 'all' ||
      (filter === 'tracked' && isTracked) ||
      (filter === 'unfinished' && unfinished) ||
      item.source === filter;
    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    list.innerHTML = `<div class="panel"><p>No items found. Add one from Custom Track, load presets, or import task items after syncing.</p></div>`;
    return;
  }

  filtered.forEach(item => {
    const clone = template.content.cloneNode(true);
    const isTracked = state.tracked.includes(item.id);
    const percent = item.needed ? (itemProgress(item) / item.needed) * 100 : 0;
    clone.querySelector('.name').textContent = item.name;
    clone.querySelector('.meta').textContent = item.note || 'No note';
    clone.querySelector('.pill').textContent = item.source;
    clone.querySelector('.progress-text').textContent = `${itemProgress(item)} / ${item.needed} collected`;
    clone.querySelector('.bar span').style.width = `${percent}%`;

    const trackBtn = clone.querySelector('.trackBtn');
    trackBtn.textContent = isTracked ? 'Untrack' : 'Track';
    trackBtn.onclick = () => toggleTrack(item.id);
    clone.querySelector('.minusBtn').onclick = () => adjustFound(item.id, -1);
    clone.querySelector('.plusBtn').onclick = () => adjustFound(item.id, 1);
    clone.querySelector('.foundBtn').onclick = () => addRaidFound(item.id);
    clone.querySelector('.deleteBtn').onclick = () => deleteItem(item.id);
    list.appendChild(clone);
  });
}

function renderRaidBag() {
  const el = $('raidBag');
  if (!el) return;
  const entries = Object.entries(state.raidBag || {}).filter(([, qty]) => qty > 0);
  if (!entries.length) {
    el.innerHTML = `<div class="panel"><p>Your raid bag is empty. Press “Found in raid” on tracked items during raid.</p></div>`;
    return;
  }
  el.innerHTML = entries.map(([id, qty]) => {
    const item = state.items.find(i => i.id === id);
    if (!item) return '';
    return `<div class="raid-row">
      <div><strong>${escapeHtml(item.name)}</strong><br><span class="meta">Temporary raid count: ${qty}</span></div>
      <div class="card-actions">
        <button onclick="changeRaidQty('${id}', -1)">-</button>
        <button onclick="changeRaidQty('${id}', 1)">+</button>
        <button class="danger" onclick="removeFromRaid('${id}')">Remove</button>
      </div>
    </div>`;
  }).join('');
}

function renderMaps() {
  const select = $('mapSelect');
  const detail = $('mapDetail');
  if (!select || !detail) return;
  const maps = mergedMaps();
  const q = ($('mapSearch').value || '').toLowerCase();
  const options = maps.map(m => `<option value="${escapeHtml(normalizeMapId(m.normalizedName || m.id || m.name))}">${escapeHtml(m.name)}</option>`).join('');
  if (select.dataset.loaded !== String(maps.length)) {
    select.innerHTML = options;
    select.dataset.loaded = String(maps.length);
  }
  activeMap = activeMap || maps[0]?.normalizedName || maps[0]?.id;
  if (![...select.options].some(o => o.value === activeMap)) activeMap = select.value || maps[0]?.normalizedName;
  select.value = activeMap;
  const map = maps.find(m => normalizeMapId(m.normalizedName || m.id || m.name) === normalizeMapId(activeMap)) || maps[0];
  if (!map) { detail.innerHTML = '<div class="panel"><p>No map data found.</p></div>'; return; }

  const extracts = (map.extracts || []).filter(e => !q || `${e.name} ${e.faction} ${e.note || ''} ${e.transferItem?.item?.name || ''}`.toLowerCase().includes(q));
  const locks = (map.locks || []).filter(l => !q || `${l.lockType} ${l.key?.name || ''} ${l.needsPower ? 'power' : ''}`.toLowerCase().includes(q));
  const bosses = (map.bosses || []);
  const keys = [...new Set([...(map.keys || []), ...(map.accessKeys || []).map(k => k.name), ...locks.map(l => l.key?.name).filter(Boolean)])];
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const localAssets = knownMapAssets(map);

  detail.innerHTML = `
    <div class="panel map-hero tac-panel">
      <div>
        <div class="kicker">LOCAL TACTICAL BOARD</div>
        <h2>${escapeHtml(map.name)}</h2>
        <p>${escapeHtml(map.description || map.notes || 'Map reference, local images, extracts and keys.')}</p>
        <div class="tags">
          ${map.players ? `<span>Players: ${escapeHtml(map.players)}</span>` : ''}
          ${map.raidDuration ? `<span>Raid: ${escapeHtml(map.raidDuration)} min</span>` : ''}
          ${map.enemies?.length ? `<span>Enemies: ${map.enemies.map(escapeHtml).join(', ')}</span>` : ''}
          <span>${localAssets.length} local image${localAssets.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div class="link-actions">
        <label class="buttonLink small">Upload own map image<input id="mapImageInput" type="file" accept="image/*" hidden onchange="importMapImage(event)"></label>
        <button onclick="clearMapImage()" class="danger small">Clear upload</button>
        <a class="buttonLink small" target="_blank" rel="noreferrer" href="${wikiMapLink(mapId, map.wiki)}">Open Fandom interactive map</a>
        <a class="buttonLink small" target="_blank" rel="noreferrer" href="${mapLink(mapId)}">Open tarkov.dev map</a>
      </div>
    </div>
    ${renderLocalMapBoard(map, extracts, locks, bosses, keys)}
    <div class="two-col">
      <div class="panel"><h2>Extracts</h2>${extracts.length ? extracts.map(renderExtract).join('') : '<p>No extracts found in the current offline/API cache for this map yet. Use the interactive links above, or sync public data.</p>'}</div>
      <div class="panel"><h2>Keys / Locks</h2>${keys.length ? `<div class="key-cloud">${keys.map(k => `<button onclick="addKeyToTracker('${escapeHtml(k).replace(/'/g, "&#39;")}')">${escapeHtml(k)}</button>`).join('')}</div>` : '<p>No keys found for this map in the current cache yet.</p>'}${locks.length ? `<h3>Lock details</h3>${locks.map(renderLock).join('')}` : ''}</div>
    </div>
    <div class="two-col">
      <div class="panel"><h2>Bosses</h2>${bosses.length ? bosses.map(renderBoss).join('') : '<p>No boss data in current cache.</p>'}</div>
      <div class="panel"><h2>Transits / Switches</h2>${renderTransitsSwitches(map)}</div>
    </div>`;
}

function knownMapAssets(map) {
  const id = normalizeMapId(map?.normalizedName || map?.id || map?.name || activeMap);
  return (MAP_ASSETS || []).filter(a => normalizeMapId(a.mapId) === id);
}

function selectedMapAsset(map) {
  const id = normalizeMapId(map?.normalizedName || map?.id || map?.name || activeMap);
  const assets = knownMapAssets(map);
  const wanted = state.mapAssetChoice?.[id];
  return assets.find(a => a.file === wanted) || assets[0] || null;
}

function renderMapAssetSelector(map, selected) {
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const assets = knownMapAssets(map);
  if (!assets.length) return '<p class="meta">No local image pack for this map yet. You can upload one and it will be saved in this browser.</p>';
  return `<label class="map-variant-label">Map image variant
    <select class="map-variant-select" onchange="setMapAssetChoice('${mapId}', this.value)">
      ${assets.map(a => `<option value="${escapeHtml(a.file)}" ${selected?.file === a.file ? 'selected' : ''}>${escapeHtml(a.label)} ${a.width && a.height ? `(${a.width}×${a.height})` : ''}</option>`).join('')}
    </select>
  </label>`;
}

function renderLocalMapBoard(map, extracts, locks, bosses, keys) {
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const upload = state.mapImages?.[mapId];
  const asset = selectedMapAsset(map);
  const img = upload || asset?.file || '';
  const title = upload ? 'Uploaded browser image' : asset ? asset.label : 'Schematic mode';
  return `<div class="panel local-map-panel">
    <div class="local-map-head">
      <div><h2>Offline map board</h2><p>Local images are included in the website folder. Your selected variant and progress are remembered with browser storage.</p></div>
      <span class="pill">${escapeHtml(title)}</span>
    </div>
    ${renderMapAssetSelector(map, asset)}
    <div class="map-image-stage ${img ? 'has-image' : ''}">
      ${img ? `<img class="local-map-img" loading="lazy" decoding="async" src="${escapeHtml(img)}" alt="${escapeHtml(map.name)} map">` : `<div class="map-watermark"><strong>${escapeHtml(map.name)}</strong><span>No local map image included yet.</span></div>`}
    </div>
    <div class="map-summary-strip">
      <span>${extracts.length} extracts in cache</span><span>${keys.length} key/lock notes</span><span>${bosses.length} boss entries</span>
    </div>
    <div class="legend"><span class="extract-dot">Extract list below</span><span class="key-dot">Track keys from list</span><span class="boss-dot">Boss info if synced</span></div>
  </div>`;
}

window.setMapAssetChoice = function(mapId, file) {
  const id = normalizeMapId(mapId);
  state.mapAssetChoice = state.mapAssetChoice || {};
  state.mapAssetChoice[id] = file;
  saveState();
  toast('Map image variant saved.');
};

function renderBoardPin(type, label, idx) {
  const x = 8 + ((idx * 17) % 82);
  const y = 12 + ((idx * 29) % 76);
  return `<button class="map-pin ${type}" style="left:${x}%;top:${y}%" title="${escapeHtml(label)}"><span>${escapeHtml(label)}</span></button>`;
}

window.importMapImage = function(event) {
  const file = event.target.files?.[0];
  if (!file || !activeMap) return;
  if (file.size > 4 * 1024 * 1024 && !confirm('Large uploaded images are saved inside browser storage and may slow things down. Use the included local map pack where possible. Continue anyway?')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const id = normalizeMapId(activeMap);
    state.mapImages = state.mapImages || {};
    state.mapImages[id] = reader.result;
    saveState();
    toast('Uploaded map image saved in this browser.');
  };
  reader.readAsDataURL(file);
};
window.clearMapImage = function() {
  if (!activeMap) return;
  const id = normalizeMapId(activeMap);
  if (state.mapImages) delete state.mapImages[id];
  saveState();
  toast('Uploaded map image cleared.');
};

function renderExtract(e) {
  const req = e.transferItem?.item?.name ? `Requires: ${e.transferItem.count || 1}x ${e.transferItem.item.name}` : (e.note || '');
  const switches = e.switches?.length ? `Switches: ${e.switches.map(s => s.name).filter(Boolean).join(', ')}` : '';
  return `<div class="info-row"><strong>${escapeHtml(e.name)}</strong><span>${escapeHtml(e.faction || 'Unknown faction')}</span>${req ? `<p>${escapeHtml(req)}</p>` : ''}${switches ? `<p>${escapeHtml(switches)}</p>` : ''}</div>`;
}
function renderLock(l) { return `<div class="info-row"><strong>${escapeHtml(l.key?.name || l.lockType || 'Lock')}</strong><span>${l.needsPower ? 'Needs power' : 'No power flag'}</span><p>${escapeHtml(l.lockType || 'Door/lock')}</p></div>`; }
function renderBoss(b) { return `<div class="info-row"><strong>${escapeHtml(b.boss?.name || b.name)}</strong><span>${escapeHtml((b.spawnChance ? Math.round(b.spawnChance * 100) + '%' : '') || 'Spawn chance unknown')}</span><p>${escapeHtml((b.spawnLocations || []).map(x => x.name).filter(Boolean).join(', ') || b.spawnTrigger || 'No location note')}</p></div>`; }
function renderTransitsSwitches(map) {
  const transits = map.transits || [];
  const switches = map.switches || [];
  if (!transits.length && !switches.length) return '<p>No transit/switch data in current cache.</p>';
  return `${transits.map(t => `<div class="info-row"><strong>${escapeHtml(t.map?.name || 'Transit')}</strong><p>${escapeHtml(t.description || t.conditions || '')}</p></div>`).join('')}${switches.map(s => `<div class="info-row"><strong>${escapeHtml(s.name || s.switchType || 'Switch')}</strong><span>${escapeHtml(s.switchType || '')}</span></div>`).join('')}`;
}


function keyId(name) { return slugify(name || '').replace(/^-|-$/g, ''); }
function getLockerEntry(key) {
  const id = keyId(key.name || key);
  const existing = state.keyLocker[id] || {};
  return { id, name: key.name || key, status: 'unused', qty: 0, notes: '', map: (key.maps || [key.map]).filter(Boolean)[0] || '', ...existing };
}
function setKeyStatus(name, status) {
  const id = keyId(name);
  const old = state.keyLocker[id] || { name, qty: 0, notes: '' };
  const qty = status === 'owned' ? Math.max(1, Number(old.qty || 0)) : Number(old.qty || 0);
  state.keyLocker[id] = { ...old, name, status, qty, updatedAt: new Date().toISOString() };
  saveState();
  toast(status === 'owned' ? 'Key marked as owned.' : status === 'needed' ? 'Key marked as needed.' : 'Key mark cleared.');
}
function changeKeyQty(name, delta) {
  const id = keyId(name);
  const old = state.keyLocker[id] || { name, status: 'owned', qty: 0, notes: '' };
  const qty = Math.max(0, Number(old.qty || 0) + delta);
  state.keyLocker[id] = { ...old, name, status: qty > 0 ? 'owned' : old.status, qty, updatedAt: new Date().toISOString() };
  saveState();
}
function updateKeyNote(name, note) {
  const id = keyId(name);
  const old = state.keyLocker[id] || { name, status: 'unused', qty: 0 };
  state.keyLocker[id] = { ...old, name, notes: note, updatedAt: new Date().toISOString() };
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function addManualKey(e) {
  e.preventDefault();
  const name = $('manualKeyName').value.trim();
  if (!name) return;
  const map = $('manualKeyMap').value.trim();
  const notes = $('manualKeyNote').value.trim();
  const id = keyId(name);
  state.keyLocker[id] = { ...(state.keyLocker[id] || {}), name, map, notes, status: 'needed', qty: Number(state.keyLocker[id]?.qty || 0), manual: true, updatedAt: new Date().toISOString() };
  e.target.reset();
  saveState();
  toast('Manual key added to Key Locker.');
}
function allKnownKeys() {
  const apiKeys = (state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS).map(k => ({ ...k, manual: false }));
  const byId = new Map(apiKeys.map(k => [keyId(k.name), k]));
  Object.values(state.keyLocker || {}).forEach(k => {
    const id = keyId(k.name);
    if (!byId.has(id)) byId.set(id, { name: k.name, maps: k.map ? [k.map] : [], location: k.notes || 'Manual key entry.', manual: true });
  });
  return [...byId.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
}
function keyStatusButtons(name, entry) {
  const safe = escapeHtml(name).replace(/'/g, "&#39;");
  return `<button class="${entry.status === 'owned' ? 'success' : ''}" onclick="setKeyStatus('${safe}', 'owned')">Owned</button>
    <button class="${entry.status === 'needed' ? 'warn' : ''}" onclick="setKeyStatus('${safe}', 'needed')">Need</button>
    <button onclick="setKeyStatus('${safe}', 'unused')">Clear</button>`;
}
window.setKeyStatus = setKeyStatus;
window.changeKeyQty = changeKeyQty;
window.updateKeyNote = updateKeyNote;

function renderKeys() {
  const list = $('keysList');
  if (!list) return;
  const maps = state.apiCache.maps?.length ? state.apiCache.maps : FALLBACK_MAPS;
  const keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  const mapFilter = $('keyMapFilter');
  const mapNames = [...new Set(maps.map(m => m.name).filter(Boolean))].sort();
  if (mapFilter.dataset.loaded !== String(mapNames.length)) {
    mapFilter.innerHTML = '<option value="all">All maps</option>' + mapNames.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    mapFilter.dataset.loaded = String(mapNames.length);
  }
  const q = ($('keySearch').value || '').toLowerCase();
  const mf = mapFilter.value;
  const filtered = keys.filter(k => {
    const mapsText = (k.maps || [k.map]).filter(Boolean).join(' ');
    const text = `${k.name} ${k.shortName || ''} ${mapsText} ${k.location || ''} ${k.description || ''}`.toLowerCase();
    return (!q || text.includes(q)) && (mf === 'all' || (k.maps || [k.map]).includes(mf));
  });
  list.innerHTML = filtered.length ? filtered.map(k => {
    const locker = getLockerEntry(k);
    const statusText = locker.status === 'owned' ? `Owned${locker.qty ? ` x${locker.qty}` : ''}` : locker.status === 'needed' ? 'Needed' : 'Not marked';
    return `
    <article class="card">
      <div class="card-head"><div><h3>${escapeHtml(k.name)}</h3><p class="meta">${escapeHtml((k.maps || [k.map]).filter(Boolean).join(', ') || 'Map unknown')}</p></div><span class="pill">${escapeHtml(statusText)}</span></div>
      <p>${escapeHtml(k.location || k.description || 'No usage note in cache. Try syncing, or open the wiki link.')}</p>
      <div class="card-actions">
        <button onclick="addKeyToTracker('${escapeHtml(k.name).replace(/'/g, "&#39;")}')">Track key</button>
        ${keyStatusButtons(k.name, locker)}
        ${k.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(k.wikiLink)}">Wiki</a>` : ''}
      </div>
    </article>`;
  }).join('') : '<div class="panel"><p>No keys found.</p></div>';
}


function renderKeyLocker() {
  const list = $('lockerList');
  if (!list) return;
  const mapFilter = $('lockerMapFilter');
  const keys = allKnownKeys();
  const mapNames = [...new Set(keys.flatMap(k => (k.maps || [k.map]).filter(Boolean)).concat(Object.values(state.keyLocker || {}).map(k => k.map).filter(Boolean)))].sort();
  if (mapFilter.dataset.loaded !== String(mapNames.length)) {
    mapFilter.innerHTML = '<option value="all">All maps</option>' + mapNames.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    mapFilter.dataset.loaded = String(mapNames.length);
  }
  const q = ($('lockerSearch')?.value || '').toLowerCase();
  const filter = $('lockerFilter')?.value || 'all';
  const mf = mapFilter.value || 'all';
  const filtered = keys.filter(k => {
    const entry = getLockerEntry(k);
    const maps = (k.maps || [k.map, entry.map]).filter(Boolean);
    const text = `${k.name} ${maps.join(' ')} ${k.location || ''} ${k.description || ''} ${entry.notes || ''}`.toLowerCase();
    const missing = entry.status === 'needed' && Number(entry.qty || 0) <= 0;
    const matchesFilter = filter === 'all' || entry.status === filter || (filter === 'missing' && missing) || (filter === 'unused' && entry.status === 'unused');
    return (!q || text.includes(q)) && (mf === 'all' || maps.includes(mf)) && matchesFilter;
  });
  const entries = keys.map(getLockerEntry);
  const owned = entries.filter(e => e.status === 'owned').length;
  const needed = entries.filter(e => e.status === 'needed').length;
  const missing = entries.filter(e => e.status === 'needed' && Number(e.qty || 0) <= 0).length;
  $('lockerSummary').innerHTML = `<div class="stats inline-stats">
    <div class="stat"><strong>${owned}</strong><span>owned keys</span></div>
    <div class="stat"><strong>${needed}</strong><span>needed keys</span></div>
    <div class="stat"><strong>${missing}</strong><span>still missing</span></div>
    <div class="stat"><strong>${keys.length}</strong><span>known keys</span></div>
  </div>`;
  list.innerHTML = filtered.length ? filtered.map(k => {
    const entry = getLockerEntry(k);
    const maps = (k.maps || [k.map, entry.map]).filter(Boolean);
    const safe = escapeHtml(k.name).replace(/'/g, "&#39;");
    const status = entry.status === 'owned' ? `Owned x${entry.qty || 1}` : entry.status === 'needed' ? 'Needed' : 'Not marked';
    const note = entry.notes || k.location || k.description || 'No note yet.';
    return `<article class="card key-locker-card">
      <div class="card-head"><div><h3>${escapeHtml(k.name)}</h3><p class="meta">${escapeHtml(maps.join(', ') || 'Map unknown')}</p></div><span class="pill">${escapeHtml(status)}</span></div>
      <p>${escapeHtml(note)}</p>
      <div class="qty-row"><span>Owned qty</span><button onclick="changeKeyQty('${safe}', -1)">-</button><strong>${Number(entry.qty || 0)}</strong><button onclick="changeKeyQty('${safe}', 1)">+</button></div>
      <textarea rows="2" placeholder="Your note: spawn, use, who has spare keys..." oninput="updateKeyNote('${safe}', this.value)">${escapeHtml(entry.notes || '')}</textarea>
      <div class="card-actions">
        ${keyStatusButtons(k.name, entry)}
        <button onclick="addKeyToTracker('${safe}')">Track as item</button>
        ${k.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(k.wikiLink)}">Wiki</a>` : ''}
      </div>
    </article>`;
  }).join('') : '<div class="panel"><p>No keys match that filter.</p></div>';
}

function renderTasks() {
  const list = $('taskList');
  if (!list) return;
  const tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  const traderFilter = $('taskTraderFilter');
  const traders = [...new Set(tasks.map(t => t.trader?.name).filter(Boolean))].sort();
  if (traderFilter.dataset.loaded !== String(traders.length)) {
    traderFilter.innerHTML = '<option value="all">All traders</option>' + traders.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    traderFilter.dataset.loaded = String(traders.length);
  }
  const q = ($('taskSearch').value || '').toLowerCase();
  const tf = traderFilter.value;
  const filtered = tasks.filter(t => {
    const itemText = (t.objectives || []).flatMap(o => o.items || []).map(i => i.name).join(' ');
    const objectiveText = (t.objectives || []).map(o => o.description || '').join(' ');
    const keyText = requiredKeysForTask(t).map(k => k.name).join(' ');
    const text = `${t.name} ${t.trader?.name || ''} ${itemText} ${objectiveText} ${keyText}`.toLowerCase();
    return (!q || text.includes(q)) && (tf === 'all' || t.trader?.name === tf);
  });
  list.innerHTML = filtered.length ? filtered.map(renderTaskCard).join('') : '<div class="panel"><p>No mission data found for that search. The offline sample missions are loaded by default; press Sync Tarkov Data to pull the full current mission list from tarkov.dev.</p></div>';
}

function taskStatus(id) { return state.missionProgress?.[id] || 'todo'; }
function setTaskStatus(id, status) {
  state.missionProgress[id] = status;
  saveState();
}
window.setTaskStatus = setTaskStatus;
function objectiveKey(taskId, objectiveId) { return `${taskId}::${objectiveId || 'objective'}`; }
function objectiveDone(taskId, objectiveId) { return !!state.taskObjectives?.[objectiveKey(taskId, objectiveId)]; }
function setObjectiveDone(taskId, objectiveId, checked) {
  state.taskObjectives = state.taskObjectives || {};
  const key = objectiveKey(taskId, objectiveId);
  if (checked) state.taskObjectives[key] = true; else delete state.taskObjectives[key];
  saveState();
}
window.setObjectiveDone = setObjectiveDone;
function findTrackedItemByName(name) {
  const target = String(name || '').toLowerCase();
  return state.items.find(i => String(i.name || '').toLowerCase() === target);
}
function itemStatusLine(req) {
  const item = findTrackedItemByName(req.name);
  if (!item) return `<span class="need-bad">not tracked</span>`;
  const have = itemProgress(item);
  const needed = Math.max(req.count || 1, item.needed || 1);
  const ok = have >= req.count;
  return `<span class="${ok ? 'need-good' : 'need-warn'}">have ${have}/${req.count}</span>`;
}
function addTaskItemToRaid(name) {
  const item = findTrackedItemByName(name);
  if (!item) { toast('Track this mission item first, then add found copies from raid.'); return; }
  window.addRaidFound(item.id);
}
window.addTaskItemToRaid = addTaskItemToRaid;

function renderTaskCard(t) {
  const objectivesArr = (t.objectives || []);
  const doneCount = objectivesArr.filter(o => objectiveDone(t.id, o.id)).length;
  const objectives = objectivesArr.map((o, idx) => {
    const mapText = o.maps?.length ? ` • ${o.maps.map(m => m.name || m.normalizedName).filter(Boolean).join(', ')}` : '';
    const objItems = objectiveItems(o);
    const itemText = objItems.length ? ` — ${o.count || 1}x ${objItems.map(i => i.name).join(' / ')}${o.foundInRaid ? ' (FIR)' : ''}` : '';
    const optional = o.optional ? 'Optional: ' : '';
    const targets = o.targetNames?.length ? ` — targets: ${o.targetNames.join(', ')}` : '';
    const checked = objectiveDone(t.id, o.id) ? 'checked' : '';
    return `<li class="objective-line ${checked ? 'checked' : ''}"><label><input type="checkbox" ${checked} onchange="setObjectiveDone('${escapeHtml(t.id)}','${escapeHtml(o.id || String(idx))}', this.checked)"> <span>${escapeHtml(optional + (o.description || o.type || 'Objective') + itemText + targets + mapText)}</span></label></li>`;
  }).join('') || '<li>No objective details in synced data.</li>';
  const reqItems = taskRequiredItems(t);
  const reqKeys = requiredKeysForTask(t);
  const prereqs = (t.taskRequirements || []).map(r => r.task?.name || r.name).filter(Boolean);
  const status = taskStatus(t.id);
  return `<div class="panel task-card ${status === 'complete' ? 'done' : ''}">
    <div class="card-head">
      <div><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.trader?.name || 'Trader unknown')} ${t.minPlayerLevel ? `• Level ${t.minPlayerLevel}` : ''} ${t.kappaRequired ? '• Kappa' : ''} • Steps ${doneCount}/${objectivesArr.length || 0}</p></div>
      <span class="pill">${escapeHtml(status)}</span>
    </div>
    <div class="card-actions mission-actions">
      <button onclick="setTaskStatus('${escapeHtml(t.id)}','todo')">To do</button>
      <button onclick="setTaskStatus('${escapeHtml(t.id)}','active')">Active</button>
      <button class="success" onclick="setTaskStatus('${escapeHtml(t.id)}','complete')">Done</button>
      <button onclick="importOneTask('${escapeHtml(t.id)}', false)">Track mission items</button>
      <button onclick="importOneTask('${escapeHtml(t.id)}', true)">Track FIR only</button>
      <button onclick="trackTaskKeys('${escapeHtml(t.id)}')">Track keys</button>
      ${t.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(t.wikiLink)}">Wiki</a>` : ''}
    </div>
    ${prereqs.length ? `<p><strong>Required before:</strong> ${escapeHtml(prereqs.join(', '))}</p>` : ''}
    <h4>Steps / objectives</h4><ul class="objective-list">${objectives}</ul>
    <div class="requirement-boxes">
      <div><strong>Items needed</strong>${reqItems.length ? `<ul>${reqItems.map(i => `<li><span>${escapeHtml(i.count + 'x ' + i.name + (i.foundInRaid ? ' (FIR)' : ''))}</span> ${itemStatusLine(i)} <button class="tiny" onclick="addTaskItemToRaid('${escapeHtml(i.name).replace(/'/g, "&#39;")}')">Found in raid</button></li>`).join('')}</ul>` : '<p>No item hand-in/objective item detected.</p>'}</div>
      <div><strong>Keys that may be needed</strong>${reqKeys.length ? `<ul>${reqKeys.map(k => `<li>${escapeHtml(k.name)}${k.maps?.length ? ` <span class="meta">${escapeHtml(k.maps.join(', '))}</span>` : ''}</li>`).join('')}</ul>` : '<p>No key detected in objective/key data.</p>'}</div>
    </div>
  </div>`;
}

function objectiveItems(o) {
  const arr = [];
  if (o.item?.name) arr.push(o.item);
  if (Array.isArray(o.items)) arr.push(...o.items.filter(i => i?.name));
  if (o.questItem?.name) arr.push({ name: o.questItem.name, shortName: o.questItem.shortName });
  const seen = new Set();
  return arr.filter(i => { const key = String(i.name).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

function taskRequiredItems(t) {
  const byName = new Map();
  (t.objectives || []).forEach(o => {
    objectiveItems(o).forEach(it => {
      const name = it.name;
      const old = byName.get(name) || { name, count: 0, foundInRaid: false };
      old.count += Number(o.count || 1);
      old.foundInRaid = old.foundInRaid || !!o.foundInRaid;
      byName.set(name, old);
    });
  });
  return [...byName.values()].sort((a,b) => a.name.localeCompare(b.name));
}

function requiredKeysForTask(t) {
  const keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  const hay = `${t.name} ${(t.objectives || []).map(o => o.description || '').join(' ')}`.toLowerCase();
  return keys.filter(k => {
    const nm = (k.name || '').toLowerCase();
    const short = (k.shortName || '').toLowerCase();
    const usedInThisTask = (k.usedInTasks || []).some(taskName => String(taskName).toLowerCase() === String(t.name).toLowerCase());
    return usedInThisTask || (nm && hay.includes(nm)) || (short && short.length > 3 && hay.includes(short));
  }).slice(0, 12);
}

window.importOneTask = function(taskId, firOnly) {
  const task = (state.apiCache.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  let added = 0;
  taskRequiredItems(task).forEach(v => {
    if (firOnly && !v.foundInRaid) return;
    const existing = state.items.find(i => i.name.toLowerCase() === v.name.toLowerCase() && i.source === 'quest');
    if (existing) existing.needed = Math.max(existing.needed, v.count);
    else { const item = { id: crypto.randomUUID(), name: v.name, needed: v.count, found: 0, source: 'quest', note: `${task.name}${v.foundInRaid ? ' • FIR' : ''}` }; state.items.push(item); state.tracked.push(item.id); added++; }
  });
  saveState(); toast(`Mission items tracked: ${added} new card(s).`);
};

window.trackTaskKeys = function(taskId) {
  const task = (state.apiCache.tasks || []).find(t => t.id === taskId);
  if (!task) return;
  const keys = requiredKeysForTask(task);
  keys.forEach(k => addKeyToTracker(k.name));
  toast(keys.length ? `Tracked ${keys.length} key(s).` : 'No keys detected for this task.');
};

function renderStory() {
  const list = $('storyList');
  if (!list) return;
  const q = ($('storySearch')?.value || '').toLowerCase();
  const chapters = STORY_CHAPTERS.filter(c => !q || `${c.name} ${c.note}`.toLowerCase().includes(q));
  list.innerHTML = chapters.map(c => {
    const status = state.storyProgress?.[c.id] || 'todo';
    return `<article class="card story-card ${status === 'complete' ? 'done' : ''}">
      <div class="card-head"><div><h3>${escapeHtml(c.name)}</h3><p class="meta">Story chapter</p></div><span class="pill">${escapeHtml(status)}</span></div>
      <p>${escapeHtml(c.note)}</p>
      <div class="card-actions">
        <button onclick="setStoryStatus('${c.id}','todo')">To do</button>
        <button onclick="setStoryStatus('${c.id}','active')">Active</button>
        <button class="success" onclick="setStoryStatus('${c.id}','complete')">Done</button>
        <a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(c.wiki)}">Wiki</a>
      </div>
    </article>`;
  }).join('');
}
function setStoryStatus(id, status) { state.storyProgress[id] = status; saveState(); }
window.setStoryStatus = setStoryStatus;

function renderSyncStatus() {
  const el = $('syncStatus');
  if (!el) return;
  el.innerHTML = `<p><strong>Current data:</strong> ${escapeHtml(state.apiCache.source || 'unknown')}<br><strong>Last sync:</strong> ${state.apiCache.syncedAt ? escapeHtml(new Date(state.apiCache.syncedAt).toLocaleString()) : 'Never'}<br><strong>Maps:</strong> ${state.apiCache.maps?.length || 0} • <strong>Keys:</strong> ${state.apiCache.keys?.length || 0} • <strong>Missions:</strong> ${state.apiCache.tasks?.length || 0} • <strong>Story chapters:</strong> ${STORY_CHAPTERS.length}</p>`;
}

function render() {
  renderStats();
  renderTrackedList();
  renderItems();
  renderRaidBag();
  renderMaps();
  renderKeys();
  renderKeyLocker();
  renderTasks();
  renderStory();
  renderSyncStatus();
}

function toggleTrack(id) { state.tracked = state.tracked.includes(id) ? state.tracked.filter(x => x !== id) : [...state.tracked, id]; saveState(); }
function adjustFound(id, delta) { const item = state.items.find(i => i.id === id); if (!item) return; item.found = Math.max(0, Math.min(item.needed, (item.found || 0) + delta)); saveState(); }
window.addRaidFound = function(id) { if (!state.tracked.includes(id)) state.tracked.push(id); state.raidBag[id] = (state.raidBag[id] || 0) + 1; saveState(); toast('Added to raid bag. Not counted until safe extract.'); };
window.changeRaidQty = function(id, delta) { state.raidBag[id] = Math.max(0, (state.raidBag[id] || 0) + delta); if (state.raidBag[id] === 0) delete state.raidBag[id]; saveState(); };
window.removeFromRaid = function(id) { delete state.raidBag[id]; saveState(); };
function deleteItem(id) { state.items = state.items.filter(i => i.id !== id); state.tracked = state.tracked.filter(x => x !== id); delete state.raidBag[id]; saveState(); }
function safeExtract() { Object.entries(state.raidBag).forEach(([id, qty]) => { const item = state.items.find(i => i.id === id); if (item) item.found = Math.min(item.needed, (item.found || 0) + qty); }); state.raidBag = {}; saveState(); toast('Safe extract confirmed. Raid items counted.'); }
function lostRaid() { state.raidBag = {}; saveState(); toast('Raid lost. Temporary items cleared.'); }

function addCustomItem(e) {
  e.preventDefault();
  const item = { id: crypto.randomUUID(), name: $('customName').value.trim(), needed: Number($('customQty').value), found: 0, source: $('customSource').value, note: $('customNote').value.trim() };
  state.items.push(item); state.tracked.push(item.id); e.target.reset(); $('customQty').value = 1; saveState(); toast('Custom item added and tracked.');
}
function loadPresets() { const existingNames = new Set(state.items.map(i => i.name.toLowerCase())); const toAdd = starterItems.filter(i => !existingNames.has(i.name.toLowerCase())).map(i => ({ ...i, id: crypto.randomUUID() })); state.items.push(...toAdd); saveState(); toast(`Loaded ${toAdd.length} starter items.`); }
window.addKeyToTracker = function(name) { const decoded = document.createElement('textarea'); decoded.innerHTML = name; const keyName = decoded.value; const id = keyId(keyName); const old = state.keyLocker[id] || { name: keyName, qty: 0, notes: '' }; state.keyLocker[id] = { ...old, name: keyName, status: old.status === 'owned' ? 'owned' : 'needed', updatedAt: new Date().toISOString() }; const existing = state.items.find(i => i.name.toLowerCase() === keyName.toLowerCase()); if (existing) { if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id); toast('Key already exists, now tracked.'); saveState(); return; } const item = { id: crypto.randomUUID(), name: keyName, needed: 1, found: 0, source: 'key', note: 'Key to bring/use. Added from Keys/Maps page.' }; state.items.push(item); state.tracked.push(item.id); saveState(); toast('Key added to tracker.'); };

function importTaskItems(foundInRaidOnly) {
  const tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  const add = new Map();
  tasks.forEach(t => (t.objectives || []).forEach(o => {
    const objItems = objectiveItems(o);
    if (!objItems.length) return;
    if (foundInRaidOnly && !o.foundInRaid) return;
    objItems.forEach(it => {
      const key = it.name.toLowerCase();
      const old = add.get(key) || { name: it.name, count: 0, notes: [] };
      old.count += Number(o.count || 1);
      old.notes.push(`${t.name}${o.foundInRaid ? ' FIR' : ''}`);
      add.set(key, old);
    });
  }));
  let added = 0;
  for (const v of add.values()) {
    const existing = state.items.find(i => i.name.toLowerCase() === v.name.toLowerCase() && i.source === 'quest');
    if (existing) { existing.needed = Math.max(existing.needed, v.count); continue; }
    const item = { id: crypto.randomUUID(), name: v.name, needed: v.count, found: 0, source: 'quest', note: `Imported from tasks: ${v.notes.slice(0, 4).join(', ')}${v.notes.length > 4 ? '...' : ''}` };
    state.items.push(item); state.tracked.push(item.id); added++;
  }
  saveState(); toast(`Imported ${added} task item tracker cards.`);
}

function exportSave() { const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `local-raid-tracker-save-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url); }
function importSave(file) { const reader = new FileReader(); reader.onload = () => { try { const imported = JSON.parse(reader.result); if (!Array.isArray(imported.items)) throw new Error('Invalid save file'); state = { ...defaultState(), ...imported, apiCache: { ...defaultState().apiCache, ...(imported.apiCache || {}) }, keyLocker: imported.keyLocker || {}, missionProgress: imported.missionProgress || {}, taskObjectives: imported.taskObjectives || {}, storyProgress: imported.storyProgress || {}, mapImages: imported.mapImages || {}, mapAssetChoice: imported.mapAssetChoice || {} }; saveState(); toast('Save imported.'); } catch { alert('Could not import save file.'); } }; reader.readAsText(file); }
function resetAll() { if (!confirm('Reset all tracker data on this browser?')) return; state = defaultState(); saveState(); }
function clearApiCache() { state.apiCache = defaultState().apiCache; saveState(); toast('Synced data cache cleared.'); }

async function gql(query) {
  const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map(e => e.message).join(', '));
  return json.data;
}

async function syncTarkovData() {
  const status = $('syncStatus');
  if (status) status.innerHTML = '<p>Syncing from tarkov.dev API. This can partially succeed if one public endpoint has bad data.</p>';
  const notes = [];
  let maps = FALLBACK_MAPS;
  let keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  let tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;

  try {
    const mapData = await gql(`query LocalRaidTrackerMapsSafe {
      maps {
        id name normalizedName wiki description enemies raidDuration players minPlayerLevel maxPlayerLevel
        extracts { id name faction transferItem { count item { name shortName } } switches { id name switchType } }
        switches { id name switchType }
        bosses { boss { name normalizedName } spawnChance spawnTrigger spawnLocations { name chance } }
      }
    }`);
    maps = (mapData.maps || []).map(m => ({ ...m, keys: m.keys || [] }));
    notes.push(`maps ${maps.length}`);
  } catch (err) {
    console.warn('Map sync failed', err);
    notes.push(`maps failed: ${err.message}`);
  }

  try {
    const keyData = await gql(`query LocalRaidTrackerKeysSafe {
      keys: items(type: keys) { id name shortName description wikiLink properties { ... on ItemPropertiesKey { uses } } usedInTasks { name } }
    }`);
    keys = (keyData.keys || FALLBACK_KEYS).map(k => ({
      id: k.id, name: k.name, shortName: k.shortName, description: k.description, wikiLink: k.wikiLink,
      uses: k.properties?.uses || null, usedInTasks: (k.usedInTasks || []).map(t => t.name), maps: [],
      location: 'Key synced from tarkov.dev. Use mission detection, wiki, or map lock data where available.', source: 'tarkov.dev API'
    }));
    notes.push(`keys ${keys.length}`);
  } catch (err) {
    console.warn('Key sync failed', err);
    notes.push(`keys failed: ${err.message}`);
  }

  try {
    const taskData = await gql(`query LocalRaidTrackerTasksSafe {
      tasks {
        id name minPlayerLevel wikiLink kappaRequired trader { name }
        objectives {
          id type description optional
          ... on TaskObjectiveItem { item { id name shortName } items { id name shortName } count foundInRaid }
          ... on TaskObjectiveQuestItem { questItem { name shortName } count }
          ... on TaskObjectiveShoot { targetNames count }
        }
      }
    }`);
    tasks = (taskData.tasks || []).map(t => ({ ...t, source: 'tarkov.dev API' }));
    notes.push(`missions ${tasks.length}`);
  } catch (err) {
    console.warn('Task sync failed', err);
    notes.push(`missions failed: ${err.message}`);
  }

  state.apiCache = { maps: maps.length ? maps : FALLBACK_MAPS, keys: keys.length ? keys : FALLBACK_KEYS, tasks: tasks.length ? tasks : FALLBACK_TASKS, syncedAt: new Date().toISOString(), source: `tarkov.dev GraphQL API / partial sync (${notes.join(' • ')})` };
  saveState();
  if (status) status.innerHTML = `<p><strong>Sync complete.</strong><br>${notes.map(escapeHtml).join('<br>')}</p>`;
  toast(`Sync finished: ${notes.join(' • ')}`);
}

function wireEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(b => b.classList.remove('active')); document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); btn.classList.add('active'); $(btn.dataset.page).classList.add('active'); }));
  ['searchInput','filterSelect','mapSearch','keySearch','keyMapFilter','lockerSearch','lockerFilter','lockerMapFilter','taskSearch','taskTraderFilter','storySearch'].forEach(id => $(id)?.addEventListener('input', render));
  $('mapSelect')?.addEventListener('change', e => { activeMap = e.target.value; renderMaps(); });
  $('customForm').addEventListener('submit', addCustomItem);
  $('manualKeyForm')?.addEventListener('submit', addManualKey);
  $('loadPresetBtn').addEventListener('click', loadPresets);
  $('extractBtn').addEventListener('click', safeExtract); $('dashExtractBtn').addEventListener('click', safeExtract);
  $('deathBtn').addEventListener('click', lostRaid); $('dashDeathBtn').addEventListener('click', lostRaid);
  $('exportBtn').addEventListener('click', exportSave);
  $('importInput').addEventListener('change', e => e.target.files[0] && importSave(e.target.files[0]));
  $('resetBtn').addEventListener('click', resetAll);
  $('syncBtn').addEventListener('click', syncTarkovData); $('syncBtn2').addEventListener('click', syncTarkovData);
  $('clearApiCacheBtn').addEventListener('click', clearApiCache);
  $('importFirTasksBtn').addEventListener('click', () => importTaskItems(true));
  $('importAllTasksBtn').addEventListener('click', () => importTaskItems(false));
}

/* init moved to v8 end */

/* ===== v7 overrides: tactical UI, collapsed tasks, story checklists, hideout tracker ===== */
var taskResultLimit = 260;

function defaultState() {
  return {
    items: [],
    tracked: [],
    raidBag: {},
    apiCache: { maps: FALLBACK_MAPS, keys: FALLBACK_KEYS, tasks: FALLBACK_TASKS, hideout: FALLBACK_HIDEOUT_STATIONS, syncedAt: null, source: 'offline fallback' },
    mapImages: {},
    mapAssetChoice: {},
    keyLocker: {},
    missionProgress: {},
    taskObjectives: {},
    storyProgress: {},
    hideoutProgress: {},
    appPrefs: { tipsHidden: {} },
    updatedAt: new Date().toISOString()
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || LEGACY_STORAGE_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    const parsed = saved ? JSON.parse(saved) : {};
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      apiCache: { ...base.apiCache, ...(parsed.apiCache || {}), hideout: parsed.apiCache?.hideout || base.apiCache.hideout },
      keyLocker: parsed.keyLocker || {},
      missionProgress: parsed.missionProgress || {},
      taskObjectives: parsed.taskObjectives || {},
      storyProgress: parsed.storyProgress || {},
      hideoutProgress: parsed.hideoutProgress || {},
      appPrefs: { ...base.appPrefs, ...(parsed.appPrefs || {}), tipsHidden: parsed.appPrefs?.tipsHidden || {} },
      mapImages: parsed.mapImages || {},
      mapAssetChoice: parsed.mapAssetChoice || {}
    };
  } catch {
    return defaultState();
  }
}

function debounce(fn, wait = 140) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function flattenDeep(arr) { return (arr || []).flat ? (arr || []).flat(Infinity) : [].concat(...(arr || [])); }
function uniqueByName(list) {
  const seen = new Set();
  return (list || []).filter(x => {
    const name = (x?.name || x?.shortName || '').toLowerCase();
    if (!name || seen.has(name)) return false;
    seen.add(name); return true;
  });
}

function addTrackerItem(name, qty = 1, source = 'custom', note = '') {
  if (!name) return null;
  const clean = String(name).trim();
  const existing = state.items.find(i => i.name.toLowerCase() === clean.toLowerCase() && i.source === source);
  if (existing) {
    existing.needed = Math.max(Number(existing.needed || 0), Number(qty || 1));
    if (note && !String(existing.note || '').includes(note)) existing.note = `${existing.note || ''}${existing.note ? ' | ' : ''}${note}`;
    if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id);
    return existing;
  }
  const item = { id: crypto.randomUUID(), name: clean, needed: Number(qty || 1), found: 0, source, note };
  state.items.push(item);
  state.tracked.push(item.id);
  return item;
}

function objectiveItems(o) {
  const out = [];
  const count = Number(o?.count || 1);
  const pushItem = (it, c = count) => { if (it?.name) out.push({ ...it, count: c }); };
  if (o?.item) pushItem(o.item);
  if (o?.questItem) pushItem(o.questItem);
  if (o?.markerItem) pushItem(o.markerItem, 1);
  if (Array.isArray(o?.items)) o.items.forEach(it => pushItem(it));
  if (Array.isArray(o?.useAny)) o.useAny.forEach(it => pushItem(it));
  if (Array.isArray(o?.containsAll)) o.containsAll.forEach(it => pushItem(it));
  return uniqueByName(out);
}

function objectiveMaps(o) {
  const maps = [];
  if (Array.isArray(o?.maps)) maps.push(...o.maps);
  if (Array.isArray(o?.zones)) o.zones.forEach(z => { if (z?.map) maps.push(z.map); });
  if (Array.isArray(o?.possibleLocations)) o.possibleLocations.forEach(z => { if (z?.map) maps.push(z.map); });
  return uniqueByName(maps).map(m => m.name).join(', ');
}

function requiredKeysForTask(t) {
  const explicit = [];
  (t.objectives || []).forEach(o => flattenDeep(o.requiredKeys || []).forEach(k => { if (k?.name) explicit.push(k); }));
  if (explicit.length) return uniqueByName(explicit).map(k => k.name);
  const text = `${t.name} ${(t.objectives || []).map(o => o.description || '').join(' ')}`.toLowerCase();
  return (state.apiCache.keys || FALLBACK_KEYS).filter(k => text.includes((k.name || '').toLowerCase())).slice(0, 8).map(k => k.name);
}

function renderStats() {
  const tracked = state.tracked.length;
  const raidQty = Object.values(state.raidBag || {}).reduce((a,b)=>a+b,0);
  const ownedKeys = Object.values(state.keyLocker || {}).filter(k => k.status === 'owned').length;
  const tasks = state.apiCache.tasks?.length || FALLBACK_TASKS.length;
  const hideout = getHideoutStations();
  const maxed = hideout.filter(s => hideoutCurrentLevel(s) >= hideoutMaxLevel(s)).length;
  const stats = [
    ['Tracked', tracked], ['Raid bag', raidQty], ['Owned keys', ownedKeys], ['Missions cached', tasks], ['Hideout maxed', `${maxed}/${hideout.length}`], ['Last sync', state.apiCache.syncedAt ? new Date(state.apiCache.syncedAt).toLocaleDateString() : 'Offline']
  ];
  if ($('stats')) $('stats').innerHTML = stats.map(([label,val]) => `<div class="stat"><strong>${escapeHtml(val)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function applyTips() {
  document.querySelectorAll('[data-tip-id]').forEach(el => {
    const id = el.getAttribute('data-tip-id');
    el.classList.toggle('hidden', Boolean(state.appPrefs?.tipsHidden?.[id]));
  });
}
window.hideTip = function(id) {
  state.appPrefs = state.appPrefs || { tipsHidden: {} };
  state.appPrefs.tipsHidden = state.appPrefs.tipsHidden || {};
  state.appPrefs.tipsHidden[id] = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyTips();
};

function taskSearchText(t) {
  return [t.name, t.trader?.name, t.map?.name, ...(t.objectives || []).map(o => [o.description, objectiveMaps(o), ...objectiveItems(o).map(i => i.name), ...flattenDeep(o.requiredKeys || []).map(k => k?.name)].filter(Boolean).join(' '))].filter(Boolean).join(' ').toLowerCase();
}

function renderTasks() {
  const list = $('taskList');
  if (!list) return;
  const tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  const q = ($('taskSearch')?.value || '').toLowerCase().trim();
  const trader = $('taskTraderFilter')?.value || 'all';
  const traders = [...new Set(tasks.map(t => t.trader?.name).filter(Boolean))].sort();
  if ($('taskTraderFilter') && $('taskTraderFilter').options.length <= 1) {
    $('taskTraderFilter').innerHTML = '<option value="all">All traders</option>' + traders.map(t => `<option>${escapeHtml(t)}</option>`).join('');
  }
  let filtered = tasks.filter(t => (!q || taskSearchText(t).includes(q)) && (trader === 'all' || t.trader?.name === trader));
  filtered.sort((a,b) => (Number(a.minPlayerLevel || 0)-Number(b.minPlayerLevel || 0)) || (a.trader?.name || '').localeCompare(b.trader?.name || '') || a.name.localeCompare(b.name));
  const limit = q ? 400 : (taskResultLimit || 260);
  const shown = filtered.slice(0, limit);
  list.innerHTML = `<div class="task-count"><span>Showing ${shown.length} of ${filtered.length} missions — cards are collapsed for performance.</span>${filtered.length > shown.length ? `<button class="small" onclick="taskResultLimit += 260; renderTasks()">Show more</button>` : ''}</div>` + (shown.length ? shown.map(renderTaskCard).join('') : '<div class="empty">No missions matched that search.</div>');
}

function renderTaskCard(t) {
  const status = state.missionProgress[t.id] || 'todo';
  const objs = t.objectives || [];
  const items = objs.flatMap(objectiveItems);
  const keys = requiredKeysForTask(t);
  const doneClass = status === 'done' ? 'done' : '';
  const maps = uniqueByName(objs.flatMap(o => (o.maps || []).concat((o.zones || []).map(z => z?.map).filter(Boolean)))).map(m => m.name).join(', ');
  return `<details class="task-card ${doneClass}">
    <summary>
      <span class="chev">▶</span>
      <div class="task-title">
        <h3>${escapeHtml(t.name)}</h3>
        <p>${escapeHtml(t.trader?.name || 'Unknown trader')} • Level ${escapeHtml(t.minPlayerLevel || 1)}${maps ? ` • ${escapeHtml(maps)}` : ''}</p>
      </div>
      <div class="task-badges">
        <span class="badge ${status === 'done' ? 'green' : status === 'active' ? 'gold' : ''}">${escapeHtml(status)}</span>
        <span class="badge">${objs.length} steps</span>
        ${items.length ? `<span class="badge cyan">${items.length} items</span>` : ''}
        ${keys.length ? `<span class="badge gold">${keys.length} keys</span>` : ''}
      </div>
    </summary>
    <div class="task-body">
      ${t.wikiLink ? `<a href="${escapeHtml(t.wikiLink)}" target="_blank" rel="noreferrer">Wiki page</a>` : ''}
      <ul class="objective-list">${objs.map((o, idx) => renderTaskObjective(t, o, idx)).join('') || '<li>No objectives cached. Try Sync Tarkov Data.</li>'}</ul>
      ${items.length ? `<div class="req-list">${uniqueByName(items).map(i => `<span class="req-chip">${escapeHtml(i.count || 1)} × ${escapeHtml(i.name)}</span>`).join('')}</div>` : ''}
      ${keys.length ? `<div class="req-list">${keys.map(k => `<span class="req-chip">🔑 ${escapeHtml(k)}</span>`).join('')}</div>` : ''}
      <div class="task-actions-row">
        <button class="small" onclick="setMissionStatus('${t.id}', 'active')">Set active</button>
        <button class="small success" onclick="setMissionStatus('${t.id}', 'done')">Complete</button>
        <button class="small ghost" onclick="setMissionStatus('${t.id}', 'todo')">Reset</button>
        <button class="small" onclick="trackTaskItems('${t.id}', false)">Track mission items</button>
        <button class="small" onclick="trackTaskItems('${t.id}', true)">Track FIR only</button>
        ${keys.length ? `<button class="small" onclick="trackTaskKeys('${t.id}')">Track mission keys</button>` : ''}
      </div>
    </div>
  </details>`;
}

function renderTaskObjective(t, o, idx) {
  const key = `${t.id}::${o.id || idx}`;
  const checked = state.taskObjectives?.[key] ? 'checked' : '';
  const map = objectiveMaps(o);
  const suffix = [map, o.foundInRaid ? 'FIR' : '', o.count ? `x${o.count}` : ''].filter(Boolean).join(' • ');
  return `<li><input type="checkbox" ${checked} onchange="setTaskObjective('${escapeHtml(key)}', this.checked)"><span>${escapeHtml(o.description || o.type || 'Objective')}${suffix ? ` <small class="meta">${escapeHtml(suffix)}</small>` : ''}</span></li>`;
}
window.setTaskObjective = function(key, done) { state.taskObjectives[key] = done; saveState(); };
window.setMissionStatus = function(id, status) { state.missionProgress[id] = status; saveState(); };
window.trackTaskItems = function(taskId, firOnly) {
  const task = (state.apiCache.tasks || FALLBACK_TASKS).find(t => t.id === taskId);
  if (!task) return;
  let added = 0;
  (task.objectives || []).forEach(o => {
    if (firOnly && !o.foundInRaid) return;
    objectiveItems(o).forEach(it => { addTrackerItem(it.name, Number(it.count || o.count || 1), 'quest', `${task.name}${o.foundInRaid ? ' FIR' : ''}`); added++; });
  });
  saveState(); toast(`Tracked ${added} item requirement(s).`);
};
window.trackTaskKeys = function(taskId) {
  const task = (state.apiCache.tasks || FALLBACK_TASKS).find(t => t.id === taskId);
  if (!task) return;
  requiredKeysForTask(task).forEach(k => window.addKeyToTracker(k));
};

function renderStory() {
  const list = $('storyList');
  if (!list) return;
  const q = ($('storySearch')?.value || '').toLowerCase().trim();
  const chapters = STORY_CHAPTERS.filter(c => !q || [c.name,c.note,c.requirement,...(c.objectives||[]),(c.items||[]).map(i=>i.name).join(' '),(c.keys||[]).map(k=>k.name).join(' ')].join(' ').toLowerCase().includes(q));
  list.innerHTML = chapters.length ? chapters.map(renderStoryCard).join('') : '<div class="empty">No story chapters matched.</div>';
}

function renderStoryCard(c) {
  const status = state.storyProgress?.[c.id]?.status || state.storyProgress?.[c.id] || 'todo';
  const stepDone = (idx) => Boolean(state.storyProgress?.[c.id]?.steps?.[idx]);
  return `<details class="story-card ${status === 'done' ? 'done' : ''}">
    <summary>
      <span class="chev">▶</span>
      <div class="story-title"><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.requirement || c.note || 'Story chapter')}</p></div>
      <div class="task-badges"><span class="badge ${status === 'done' ? 'green' : status === 'active' ? 'gold' : ''}">${escapeHtml(status)}</span><span class="badge">${(c.objectives||[]).length} steps</span></div>
    </summary>
    <div class="story-body">
      <p>${escapeHtml(c.note || '')}</p>
      ${c.wiki ? `<a href="${escapeHtml(c.wiki)}" target="_blank" rel="noreferrer">Open live wiki guide</a>` : ''}
      <ul class="objective-list">${(c.objectives || []).map((o,idx) => `<li><input type="checkbox" ${stepDone(idx) ? 'checked' : ''} onchange="setStoryStep('${c.id}', ${idx}, this.checked)"><span>${escapeHtml(o)}</span></li>`).join('')}</ul>
      ${(c.items||[]).length ? `<h4>Items to keep/check</h4><div class="req-list">${c.items.map(i => `<span class="req-chip">${escapeHtml(i.count || 1)} × ${escapeHtml(i.name)}${i.note ? ` — ${escapeHtml(i.note)}` : ''}</span>`).join('')}</div>` : ''}
      ${(c.keys||[]).length ? `<h4>Keys / access notes</h4><div class="req-list">${c.keys.map(k => `<span class="req-chip">🔑 ${escapeHtml(k.name)}${k.map ? ` • ${escapeHtml(k.map)}` : ''}${k.note ? ` — ${escapeHtml(k.note)}` : ''}</span>`).join('')}</div>` : ''}
      <div class="task-actions-row"><button class="small" onclick="setStoryStatus('${c.id}','active')">Set active</button><button class="small success" onclick="setStoryStatus('${c.id}','done')">Complete</button><button class="small ghost" onclick="setStoryStatus('${c.id}','todo')">Reset</button>${(c.items||[]).length ? `<button class="small" onclick="trackStoryItems('${c.id}')">Track story items</button>` : ''}${(c.keys||[]).length ? `<button class="small" onclick="trackStoryKeys('${c.id}')">Track story keys</button>` : ''}</div>
    </div>
  </details>`;
}
window.setStoryStatus = function(id, status) { state.storyProgress[id] = { ...(typeof state.storyProgress[id] === 'object' ? state.storyProgress[id] : {}), status }; saveState(); };
window.setStoryStep = function(id, idx, done) { const cur = typeof state.storyProgress[id] === 'object' ? state.storyProgress[id] : { status: state.storyProgress[id] || 'todo' }; cur.steps = cur.steps || {}; cur.steps[idx] = done; state.storyProgress[id] = cur; saveState(); };
window.trackStoryItems = function(id) { const c = STORY_CHAPTERS.find(x => x.id === id); if (!c) return; (c.items || []).forEach(i => addTrackerItem(i.name, i.count || 1, 'quest', `${c.name} story chapter${i.note ? ': ' + i.note : ''}`)); saveState(); toast('Story items added to tracker.'); };
window.trackStoryKeys = function(id) { const c = STORY_CHAPTERS.find(x => x.id === id); if (!c) return; (c.keys || []).forEach(k => window.addKeyToTracker(k.name)); };

function getHideoutStations() { return state.apiCache?.hideout?.length ? state.apiCache.hideout : FALLBACK_HIDEOUT_STATIONS; }
function hideoutStationId(station) { return station.normalizedName || slugify(station.name || station.id); }
function hideoutLevels(station) { return (station.levels || []).slice().sort((a,b) => Number(a.level||0) - Number(b.level||0)); }
function hideoutMaxLevel(station) { return Math.max(0, ...hideoutLevels(station).map(l => Number(l.level || 0))); }
function hideoutCurrentLevel(station) { return Number(state.hideoutProgress?.[hideoutStationId(station)] || 0); }
function hideoutNextLevel(station) { const cur = hideoutCurrentLevel(station); return hideoutLevels(station).find(l => Number(l.level || 0) > cur) || null; }
function hideoutReqItems(level) { return (level?.itemRequirements || []).map(r => ({ name: r.item?.name || r.name || r.itemName || 'Unknown item', shortName: r.item?.shortName, count: Number(r.count || r.quantity || 1) })); }
function hideoutReqStations(level) { return (level?.stationLevelRequirements || []).map(r => `${r.station?.name || 'Station'} level ${r.level || r.stationLevel || ''}`); }
function hideoutReqSkills(level) { return (level?.skillRequirements || []).map(r => `${r.skill?.name || r.name || 'Skill'} level ${r.level || ''}`); }
function hideoutReqTraders(level) { return (level?.traderRequirements || []).map(r => `${r.trader?.name || 'Trader'} ${r.requirementType || ''} ${r.value || ''}`.trim()); }

function renderHideout() {
  const list = $('hideoutList');
  if (!list) return;
  const q = ($('hideoutSearch')?.value || '').toLowerCase().trim();
  const filter = $('hideoutFilter')?.value || 'all';
  const stations = getHideoutStations().filter(s => {
    const next = hideoutNextLevel(s);
    const text = [s.name, s.normalizedName, ...(hideoutLevels(s).flatMap(l => hideoutReqItems(l).map(i => i.name))), ...(next ? hideoutReqStations(next) : [])].join(' ').toLowerCase();
    if (q && !text.includes(q)) return false;
    const cur = hideoutCurrentLevel(s); const max = hideoutMaxLevel(s);
    if (filter === 'maxed') return cur >= max;
    if (filter === 'available') return cur < max && Boolean(next);
    if (filter === 'locked') return Boolean(next && (hideoutReqStations(next).length || hideoutReqSkills(next).length || hideoutReqTraders(next).length));
    return true;
  }).sort((a,b) => a.name.localeCompare(b.name));
  const all = getHideoutStations();
  const maxed = all.filter(s => hideoutCurrentLevel(s) >= hideoutMaxLevel(s)).length;
  if ($('hideoutSummary')) $('hideoutSummary').innerHTML = `<span class="badge gold">Stations ${all.length}</span><span class="badge green">Maxed ${maxed}</span><span class="badge cyan">Next upgrades ${all.length - maxed}</span><span class="meta">Hideout progress is saved locally.</span>`;
  list.innerHTML = stations.length ? stations.map(renderHideoutCard).join('') : '<div class="empty">No hideout stations matched.</div>';
}

function renderHideoutCard(station) {
  const id = hideoutStationId(station);
  const cur = hideoutCurrentLevel(station);
  const max = hideoutMaxLevel(station);
  const next = hideoutNextLevel(station);
  const items = hideoutReqItems(next);
  const prereq = [...hideoutReqStations(next), ...hideoutReqSkills(next), ...hideoutReqTraders(next)];
  const cls = cur >= max ? 'maxed-card' : prereq.length ? 'locked-card' : '';
  const options = [`<option value="0">Not built</option>`, ...hideoutLevels(station).map(l => `<option value="${l.level}" ${Number(l.level)===cur?'selected':''}>Level ${l.level}</option>`)].join('');
  return `<article class="hideout-card ${cls}">
    <div class="hideout-head"><div class="hideout-icon">${cur >= max ? '★' : '✣'}</div><div><h3>${escapeHtml(station.name)}</h3><p>Current level ${cur} / ${max}</p></div><div class="hideout-controls"><select onchange="setHideoutLevel('${escapeHtml(id)}', this.value)">${options}</select></div></div>
    <div class="hideout-req"><h4>${next ? `Requirements for level ${escapeHtml(next.level)}` : 'Maxed'}</h4>
      ${next ? `<ul>${items.map(i => `<li><strong>${escapeHtml(i.count)}</strong> ${escapeHtml(i.name)}</li>`).join('') || '<li>No item requirements cached.</li>'}</ul>${prereq.length ? `<div class="req-list">${prereq.map(r => `<span class="req-chip">Requires ${escapeHtml(r)}</span>`).join('')}</div>` : ''}` : '<p class="meta">This station is marked maxed.</p>'}
    </div>
    <div class="hideout-foot">${next && items.length ? `<button class="small success" onclick="trackHideoutStation('${escapeHtml(id)}')">Track next items</button>` : ''}<button class="small ghost" onclick="setHideoutLevel('${escapeHtml(id)}', ${Math.max(0,cur-1)})">- level</button><button class="small" onclick="setHideoutLevel('${escapeHtml(id)}', ${Math.min(max,cur+1)})">+ level</button></div>
  </article>`;
}
window.setHideoutLevel = function(id, level) { state.hideoutProgress[id] = Number(level || 0); saveState(); };
window.trackHideoutStation = function(id) { const station = getHideoutStations().find(s => hideoutStationId(s) === id); const next = station && hideoutNextLevel(station); if (!next) return; hideoutReqItems(next).forEach(i => addTrackerItem(i.name, i.count, 'hideout', `${station.name} level ${next.level}`)); saveState(); toast('Hideout items added to tracker.'); };
function importHideoutNeeds() { let added=0; getHideoutStations().forEach(s => { const next=hideoutNextLevel(s); if (!next) return; hideoutReqItems(next).forEach(i => { addTrackerItem(i.name, i.count, 'hideout', `${s.name} level ${next.level}`); added++; }); }); saveState(); toast(`Imported ${added} next-upgrade hideout requirements.`); }

function render() {
  renderStats();
  renderTrackedList();
  renderRaidMini();
  renderItems();
  renderRaidBag();
  renderMaps();
  renderKeys();
  renderKeyLocker();
  renderHideout();
  renderTasks();
  renderStory();
  renderSyncStatus();
  applyTips();
}

function importSave(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.items)) throw new Error('Invalid save file');
      const base = defaultState();
      state = {
        ...base,
        ...imported,
        apiCache: { ...base.apiCache, ...(imported.apiCache || {}), hideout: imported.apiCache?.hideout || base.apiCache.hideout },
        keyLocker: imported.keyLocker || {},
        missionProgress: imported.missionProgress || {},
        taskObjectives: imported.taskObjectives || {},
        storyProgress: imported.storyProgress || {},
        hideoutProgress: imported.hideoutProgress || {},
        appPrefs: { ...base.appPrefs, ...(imported.appPrefs || {}), tipsHidden: imported.appPrefs?.tipsHidden || {} },
        mapImages: imported.mapImages || {},
        mapAssetChoice: imported.mapAssetChoice || {}
      };
      saveState(); toast('Save imported.');
    } catch { alert('Could not import save file.'); }
  };
  reader.readAsText(file);
}
function clearApiCache() { state.apiCache = defaultState().apiCache; saveState(); toast('Synced data cache cleared.'); }

async function syncTarkovData() {
  const status = $('syncStatus');
  if (status) status.innerHTML = '<p>Syncing from tarkov.dev API. This can partially succeed if one public endpoint has bad data.</p>';
  const notes = [];
  let maps = state.apiCache.maps?.length ? state.apiCache.maps : FALLBACK_MAPS;
  let keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  let tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  let hideout = state.apiCache.hideout?.length ? state.apiCache.hideout : FALLBACK_HIDEOUT_STATIONS;
  try {
    const mapData = await gql(`query LocalRaidTrackerMapsSafe {
      maps { id name normalizedName wiki description enemies raidDuration players minPlayerLevel maxPlayerLevel
        extracts { id name faction transferItem { count item { name shortName } } switches { id name switchType } }
        switches { id name switchType }
        bosses { boss { name normalizedName } spawnChance spawnTrigger spawnLocations { name chance } }
      }
    }`);
    maps = (mapData.maps || []).map(m => ({ ...m, keys: m.keys || [] })); notes.push(`maps ${maps.length}`);
  } catch (err) { console.warn('Map sync failed', err); notes.push(`maps failed: ${err.message}`); }
  try {
    const keyData = await gql(`query LocalRaidTrackerKeysSafe { keys: items(type: keys) { id name shortName description wikiLink properties { ... on ItemPropertiesKey { uses } } usedInTasks { name } } }`);
    keys = (keyData.keys || FALLBACK_KEYS).map(k => ({ id: k.id, name: k.name, shortName: k.shortName, description: k.description, wikiLink: k.wikiLink, uses: k.properties?.uses || null, usedInTasks: (k.usedInTasks || []).map(t => t.name), maps: [], location: 'Key synced from tarkov.dev. Mission objectives may also include required key references.', source: 'tarkov.dev API' }));
    notes.push(`keys ${keys.length}`);
  } catch (err) { console.warn('Key sync failed', err); notes.push(`keys failed: ${err.message}`); }
  try {
    const hideoutData = await gql(`query LocalRaidTrackerHideoutSafe {
      hideoutStations { id name normalizedName
        levels { id level constructionTime description
          itemRequirements { id count quantity item { id name shortName iconLink wikiLink } attributes { name value } }
          stationLevelRequirements { id level station { id name normalizedName } }
          skillRequirements { id name level skill { id name } }
          traderRequirements { id value requirementType compareMethod trader { id name } }
          bonuses { type name value passive production }
        }
      }
    }`);
    hideout = hideoutData.hideoutStations || FALLBACK_HIDEOUT_STATIONS; notes.push(`hideout ${hideout.length}`);
  } catch (err) { console.warn('Hideout sync failed', err); notes.push(`hideout failed: ${err.message}`); }
  try {
    const taskData = await gql(`query LocalRaidTrackerTasksBetter {
      tasks {
        id name normalizedName minPlayerLevel wikiLink kappaRequired lightkeeperRequired experience
        trader { name normalizedName }
        map { name normalizedName }
        taskRequirements { task { id name } status }
        traderRequirements { trader { name } value compareMethod requirementType }
        objectives {
          id type description optional maps { name normalizedName }
          ... on TaskObjectiveBasic { zones { map { name normalizedName } } requiredKeys { id name shortName } }
          ... on TaskObjectiveItem { item { id name shortName iconLink wikiLink } items { id name shortName iconLink wikiLink } count foundInRaid dogTagLevel maxDurability minDurability zones { map { name normalizedName } } requiredKeys { id name shortName } }
          ... on TaskObjectiveQuestItem { questItem { id name shortName iconLink wikiLink } count possibleLocations { map { name normalizedName } } zones { map { name normalizedName } } requiredKeys { id name shortName } }
          ... on TaskObjectiveShoot { targetNames count bodyParts zoneNames requiredKeys { id name shortName } }
          ... on TaskObjectiveMark { markerItem { id name shortName } zones { map { name normalizedName } } requiredKeys { id name shortName } }
          ... on TaskObjectiveUseItem { useAny { id name shortName } count zoneNames zones { map { name normalizedName } } requiredKeys { id name shortName } }
          ... on TaskObjectiveExtract { exitName count zoneNames requiredKeys { id name shortName } }
          ... on TaskObjectiveBuildItem { item { id name shortName } containsAll { id name shortName } containsCategory { name } }
          ... on TaskObjectiveHideoutStation { hideoutStation { id name normalizedName } stationLevel }
          ... on TaskObjectivePlayerLevel { playerLevel }
          ... on TaskObjectiveSkill { skillLevel { skill { name } level } }
          ... on TaskObjectiveTraderLevel { trader { name } level }
          ... on TaskObjectiveTaskStatus { task { id name } status }
        }
      }
    }`);
    tasks = (taskData.tasks || []).map(t => ({ ...t, source: 'tarkov.dev API' })); notes.push(`missions ${tasks.length}`);
  } catch (err) {
    console.warn('Task sync failed', err); notes.push(`missions failed: ${err.message}`);
  }
  state.apiCache = { maps: maps.length ? maps : FALLBACK_MAPS, keys: keys.length ? keys : FALLBACK_KEYS, tasks: tasks.length ? tasks : FALLBACK_TASKS, hideout: hideout.length ? hideout : FALLBACK_HIDEOUT_STATIONS, syncedAt: new Date().toISOString(), source: `tarkov.dev GraphQL API / partial sync (${notes.join(' • ')})` };
  saveState();
  if (status) status.innerHTML = `<p><strong>Sync complete.</strong><br>${notes.map(escapeHtml).join('<br>')}</p>`;
  toast(`Sync finished: ${notes.join(' • ')}`);
}

function wireEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = $(btn.dataset.page);
    if (page) page.classList.add('active');
  }));
  const debounced = debounce(render, 140);
  ['searchInput','mapSearch','keySearch','lockerSearch','taskSearch','storySearch','hideoutSearch'].forEach(id => $(id)?.addEventListener('input', debounced));
  ['filterSelect','keyMapFilter','lockerFilter','lockerMapFilter','taskTraderFilter','hideoutFilter'].forEach(id => $(id)?.addEventListener('change', render));
  $('mapSelect')?.addEventListener('change', e => { activeMap = e.target.value; renderMaps(); });
  $('customForm')?.addEventListener('submit', addCustomItem);
  $('manualKeyForm')?.addEventListener('submit', addManualKey);
  $('loadPresetBtn')?.addEventListener('click', loadPresets);
  $('extractBtn')?.addEventListener('click', safeExtract); $('dashExtractBtn')?.addEventListener('click', safeExtract);
  $('deathBtn')?.addEventListener('click', lostRaid); $('dashDeathBtn')?.addEventListener('click', lostRaid);
  $('exportBtn')?.addEventListener('click', exportSave);
  $('importInput')?.addEventListener('change', e => e.target.files[0] && importSave(e.target.files[0]));
  $('resetBtn')?.addEventListener('click', resetAll);
  $('syncBtn')?.addEventListener('click', syncTarkovData); $('syncBtn2')?.addEventListener('click', syncTarkovData);
  $('clearApiCacheBtn')?.addEventListener('click', clearApiCache);
  $('importFirTasksBtn')?.addEventListener('click', () => importTaskItems(true));
  $('importAllTasksBtn')?.addEventListener('click', () => importTaskItems(false));
  $('importHideoutBtn')?.addEventListener('click', importHideoutNeeds);
}

/* ===== v7 optimization override: render only the active heavy page ===== */
function activePageId() { return document.querySelector('.page.active')?.id || 'dashboard'; }
function render() {
  const active = activePageId();
  renderStats();
  if (active === 'dashboard') { renderTrackedList(); renderRaidMini(); }
  if (active === 'needed') renderItems();
  if (active === 'raid') renderRaidBag();
  if (active === 'maps') renderMaps();
  if (active === 'keys') renderKeys();
  if (active === 'keylocker') renderKeyLocker();
  if (active === 'hideout') renderHideout();
  if (active === 'tasks') renderTasks();
  if (active === 'story') renderStory();
  if (active === 'data') renderSyncStatus();
  applyTips();
}
function wireEvents() {
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const page = $(btn.dataset.page);
    if (page) page.classList.add('active');
    render();
  }));
  const debounced = debounce(render, 140);
  ['searchInput','mapSearch','keySearch','lockerSearch','taskSearch','storySearch','hideoutSearch'].forEach(id => $(id)?.addEventListener('input', debounced));
  ['filterSelect','keyMapFilter','lockerFilter','lockerMapFilter','taskTraderFilter','hideoutFilter'].forEach(id => $(id)?.addEventListener('change', render));
  $('mapSelect')?.addEventListener('change', e => { activeMap = e.target.value; renderMaps(); });
  $('customForm')?.addEventListener('submit', addCustomItem);
  $('manualKeyForm')?.addEventListener('submit', addManualKey);
  $('loadPresetBtn')?.addEventListener('click', loadPresets);
  $('extractBtn')?.addEventListener('click', safeExtract); $('dashExtractBtn')?.addEventListener('click', safeExtract);
  $('deathBtn')?.addEventListener('click', lostRaid); $('dashDeathBtn')?.addEventListener('click', lostRaid);
  $('exportBtn')?.addEventListener('click', exportSave);
  $('importInput')?.addEventListener('change', e => e.target.files[0] && importSave(e.target.files[0]));
  $('resetBtn')?.addEventListener('click', resetAll);
  $('syncBtn')?.addEventListener('click', syncTarkovData); $('syncBtn2')?.addEventListener('click', syncTarkovData);
  $('clearApiCacheBtn')?.addEventListener('click', clearApiCache);
  $('importFirTasksBtn')?.addEventListener('click', () => importTaskItems(true));
  $('importAllTasksBtn')?.addEventListener('click', () => importTaskItems(false));
  $('importHideoutBtn')?.addEventListener('click', importHideoutNeeds);
}

/* ===== v7 hotfix: dashboard mini render is handled by renderTrackedList ===== */
function render() {
  const active = activePageId();
  renderStats();
  if (active === 'dashboard') renderTrackedList();
  if (active === 'needed') renderItems();
  if (active === 'raid') renderRaidBag();
  if (active === 'maps') renderMaps();
  if (active === 'keys') renderKeys();
  if (active === 'keylocker') renderKeyLocker();
  if (active === 'hideout') renderHideout();
  if (active === 'tasks') renderTasks();
  if (active === 'story') renderStory();
  if (active === 'data') renderSyncStatus();
  applyTips();
}

/* ===== v8 fixes: new UI, task picker, map scaling, robust sync, hideout state ===== */
function ensureStateShape() {
  state.items = Array.isArray(state.items) ? state.items : [];
  state.tracked = Array.isArray(state.tracked) ? state.tracked : [];
  state.raidBag = state.raidBag || {};
  state.keyLocker = state.keyLocker || {};
  state.missionProgress = state.missionProgress || {};
  state.taskObjectives = state.taskObjectives || {};
  state.storyProgress = state.storyProgress || {};
  state.hideoutProgress = state.hideoutProgress || {};
  state.mapImages = state.mapImages || {};
  state.mapAssetChoice = state.mapAssetChoice || {};
  state.appPrefs = state.appPrefs || {};
  state.appPrefs.tipsHidden = state.appPrefs.tipsHidden || {};
  const baseCache = defaultState().apiCache;
  state.apiCache = { ...baseCache, ...(state.apiCache || {}) };
  if (!Array.isArray(state.apiCache.maps)) state.apiCache.maps = FALLBACK_MAPS;
  if (!Array.isArray(state.apiCache.keys)) state.apiCache.keys = FALLBACK_KEYS;
  if (!Array.isArray(state.apiCache.tasks)) state.apiCache.tasks = FALLBACK_TASKS;
  if (!Array.isArray(state.apiCache.hideout)) state.apiCache.hideout = FALLBACK_HIDEOUT_STATIONS;
}

function saveState() {
  ensureStateShape();
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

async function gql(query, variables = undefined, options = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    const message = json.errors.map(e => e.message).join(' | ');
    // Some tarkov.dev resolvers can return useful partial data plus an error
    // for one broken relation. For map sync we keep the partial payload instead
    // of making the whole sync look like it did nothing.
    if (options.allowPartial && json.data) {
      console.warn('GraphQL partial result used:', message);
      return json.data || {};
    }
    throw new Error(message);
  }
  return json.data || {};
}

async function syncTarkovData() {
  ensureStateShape();
  const status = $('syncStatus');
  const setStatus = (html) => { if (status) status.innerHTML = html; };
  setStatus('<p><strong>Syncing...</strong> Pulling maps, keys, missions and hideout data separately. If one part fails the rest will still save.</p>');
  if ($('syncBtn')) $('syncBtn').disabled = true;
  if ($('syncBtn2')) $('syncBtn2').disabled = true;
  const notes = [];
  let maps = state.apiCache.maps?.length ? state.apiCache.maps : FALLBACK_MAPS;
  let keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  let tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  let hideout = state.apiCache.hideout?.length ? state.apiCache.hideout : FALLBACK_HIDEOUT_STATIONS;

  try {
    const data = await gql(`query LocalTrackerMaps($lang: LanguageCode) {
      maps(lang: $lang) {
        id name normalizedName wiki description enemies raidDuration players minPlayerLevel maxPlayerLevel
        extracts { id name faction switches { id name switchType } }
        switches { id name switchType }
        bosses { boss { id name normalizedName } spawnChance spawnTrigger spawnLocations { name chance } }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    maps = (data.maps || []).map(m => ({ ...m, keys: m.keys || [] }));
    notes.push(`maps ${maps.length}`);
  } catch (err) {
    console.warn('Map sync failed', err);
    notes.push(`maps failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerKeys($lang: LanguageCode) {
      keys: items(type: keys, lang: $lang) {
        id name normalizedName shortName description wikiLink types iconLink
        properties { ... on ItemPropertiesKey { uses } }
        usedInTasks { id name normalizedName }
      }
    }`, { lang: 'en' });
    keys = (data.keys || []).map(k => ({
      id: k.id,
      name: k.name,
      normalizedName: k.normalizedName,
      shortName: k.shortName,
      description: k.description,
      wikiLink: k.wikiLink,
      uses: k.properties?.uses || null,
      usedInTasks: (k.usedInTasks || []).map(t => t.name),
      maps: [],
      location: (k.usedInTasks || []).length ? `Used in missions: ${(k.usedInTasks || []).slice(0, 5).map(t => t.name).join(', ')}` : 'Key synced from tarkov.dev. Use map locks/tasks for exact use notes where available.',
      source: 'tarkov.dev API'
    }));
    notes.push(`keys ${keys.length}`);
  } catch (err) {
    console.warn('Key sync failed', err);
    notes.push(`keys failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerHideout($lang: LanguageCode) {
      hideoutStations(lang: $lang) {
        id name normalizedName imageLink
        levels { id level constructionTime description
          itemRequirements { id count quantity item { id name normalizedName shortName iconLink wikiLink } }
          stationLevelRequirements { id level station { id name normalizedName } }
          skillRequirements { id name level skill { id name } }
          traderRequirements { id value requirementType compareMethod trader { id name } }
          bonuses { type name value passive production }
        }
      }
    }`, { lang: 'en' });
    hideout = data.hideoutStations || [];
    notes.push(`hideout ${hideout.length}`);
  } catch (err) {
    console.warn('Hideout sync failed', err);
    notes.push(`hideout failed: ${err.message}`);
  }

  try {
    let data;
    try {
      data = await gql(`query LocalTrackerTasks($lang: LanguageCode) {
        tasks(lang: $lang) {
          id tarkovDataId name normalizedName minPlayerLevel wikiLink kappaRequired lightkeeperRequired experience
          trader { id name normalizedName }
          map { id name normalizedName }
          taskRequirements { task { id name normalizedName } status }
          traderRequirements { trader { id name } value requirementType compareMethod }
          objectives {
            id type description optional maps { id name normalizedName }
            ... on TaskObjectiveBasic { requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveItem { items { id name normalizedName shortName iconLink wikiLink } count foundInRaid dogTagLevel maxDurability minDurability requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveQuestItem { questItem { id name normalizedName shortName iconLink } count possibleLocations { map { id name normalizedName } } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveShoot { targetNames count zoneNames bodyParts requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveMark { markerItem { id name normalizedName shortName iconLink wikiLink } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveUseItem { useAny { id name normalizedName shortName iconLink wikiLink } count zoneNames requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveExtract { exitName count zoneNames requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveBuildItem { item { id name normalizedName shortName iconLink wikiLink } containsAll { id name normalizedName shortName iconLink wikiLink } containsCategory { name normalizedName } }
            ... on TaskObjectiveHideoutStation { hideoutStation { id name normalizedName } stationLevel }
            ... on TaskObjectivePlayerLevel { playerLevel }
            ... on TaskObjectiveSkill { skillLevel { skill { id name } level } }
            ... on TaskObjectiveTraderLevel { trader { id name } level }
            ... on TaskObjectiveTaskStatus { task { id name normalizedName } status }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    } catch (richErr) {
      console.warn('Rich task query failed, trying minimal task query', richErr);
      data = await gql(`query LocalTrackerTasksMinimal($lang: LanguageCode) {
        tasks(lang: $lang) {
          id name normalizedName minPlayerLevel wikiLink
          trader { name normalizedName }
          map { name normalizedName }
          objectives {
            id type description maps { name normalizedName }
            ... on TaskObjectiveItem { items { name shortName } count foundInRaid }
            ... on TaskObjectiveShoot { targetNames count }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    }
    tasks = (data.tasks || []).map(t => ({ ...t, source: 'tarkov.dev API' }));
    notes.push(`missions ${tasks.length}`);
  } catch (err) {
    console.warn('Task sync failed', err);
    notes.push(`missions failed: ${err.message}`);
  }

  state.apiCache = {
    maps: maps.length ? maps : FALLBACK_MAPS,
    keys: keys.length ? keys : FALLBACK_KEYS,
    tasks: tasks.length ? tasks : FALLBACK_TASKS,
    hideout: hideout.length ? hideout : FALLBACK_HIDEOUT_STATIONS,
    syncedAt: new Date().toISOString(),
    source: `tarkov.dev GraphQL API / partial sync (${notes.join(' • ')})`
  };
  ensureStateShape();
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if ($('syncBtn')) $('syncBtn').disabled = false;
  if ($('syncBtn2')) $('syncBtn2').disabled = false;
  render();
  setStatus(`<p><strong>Sync finished.</strong><br>${notes.map(escapeHtml).join('<br>')}<br><span class="meta">If a section says failed, the app kept your previous cache/offline fallback for that section.</span></p>`);
  toast(`Sync finished: ${notes.join(' • ')}`);
}

function renderTasks() {
  ensureStateShape();
  const list = $('taskList');
  if (!list) return;
  const tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  const q = ($('taskSearch')?.value || '').toLowerCase().trim();
  const trader = $('taskTraderFilter')?.value || 'all';
  const traders = [...new Set(tasks.map(t => t.trader?.name).filter(Boolean))].sort();
  const traderFilter = $('taskTraderFilter');
  if (traderFilter && traderFilter.dataset.loaded !== String(traders.length)) {
    const old = traderFilter.value || 'all';
    traderFilter.innerHTML = '<option value="all">All traders</option>' + traders.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    traderFilter.value = [...traderFilter.options].some(o => o.value === old) ? old : 'all';
    traderFilter.dataset.loaded = String(traders.length);
  }
  let filtered = tasks.filter(t => (!q || taskSearchText(t).includes(q)) && (trader === 'all' || t.trader?.name === trader));
  filtered.sort((a,b) => (Number(a.minPlayerLevel || 0)-Number(b.minPlayerLevel || 0)) || (a.trader?.name || '').localeCompare(b.trader?.name || '') || a.name.localeCompare(b.name));
  const selectedOk = filtered.some(t => t.id === state.appPrefs.selectedTaskId);
  const selectedId = selectedOk ? state.appPrefs.selectedTaskId : filtered[0]?.id;
  const selected = filtered.find(t => t.id === selectedId);
  const options = filtered.slice(0, 900).map(t => `<option value="${escapeHtml(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${escapeHtml(t.name)}${t.trader?.name ? ` — ${escapeHtml(t.trader.name)}` : ''}${t.minPlayerLevel ? ` — L${escapeHtml(t.minPlayerLevel)}` : ''}</option>`).join('');
  list.innerHTML = `
    <div class="task-count"><span>${filtered.length} mission(s) matched. Use the dropdown so the page does not lag.</span><span>${state.apiCache.syncedAt ? 'Synced cache loaded' : 'Offline fallback loaded'}</span></div>
    <div class="task-picker-panel">
      <div><strong>Mission selector</strong><p class="meta">Pick one mission, then open the card below when you need the full steps.</p></div>
      <select onchange="selectTask(this.value)">${options || '<option>No missions matched</option>'}</select>
    </div>
    ${selected ? renderTaskCard(selected) : '<div class="empty">No mission data found. Try clearing search or syncing data.</div>'}`;
}

window.selectTask = function(id) {
  ensureStateShape();
  state.appPrefs.selectedTaskId = id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderTasks();
};

function renderStory() {
  ensureStateShape();
  const list = $('storyList');
  if (!list) return;
  const q = ($('storySearch')?.value || '').toLowerCase().trim();
  const chapters = STORY_CHAPTERS.filter(c => {
    const live = findStoryTask(c);
    const liveText = live ? taskSearchText(live) : '';
    return !q || [c.name,c.note,c.requirement,...(c.objectives||[]),(c.items||[]).map(i=>i.name).join(' '),(c.keys||[]).map(k=>k.name).join(' '),liveText].join(' ').toLowerCase().includes(q);
  });
  list.innerHTML = chapters.length ? chapters.map(renderStoryCard).join('') : '<div class="empty">No story chapters matched.</div>';
}

function findStoryTask(chapter) {
  const tasks = state.apiCache.tasks || [];
  const want = slugify(chapter.name);
  return tasks.find(t => slugify(t.normalizedName || t.name) === want || slugify(t.name) === want) || null;
}

function renderStoryCard(c) {
  const live = findStoryTask(c);
  const progress = typeof state.storyProgress?.[c.id] === 'object' ? state.storyProgress[c.id] : { status: state.storyProgress?.[c.id] || 'todo', steps: {} };
  const status = progress.status || 'todo';
  const objectives = live?.objectives?.length ? live.objectives.map(o => o.description || o.type || 'Objective') : (c.objectives || []);
  const liveItems = live?.objectives?.flatMap(objectiveItems) || [];
  const items = liveItems.length ? liveItems.map(i => ({ name: i.name, count: i.count || 1, note: live.name })) : (c.items || []);
  const liveKeys = live ? requiredKeysForTask(live).map(name => ({ name })) : [];
  const keys = liveKeys.length ? liveKeys : (c.keys || []);
  return `<details class="story-card ${status === 'done' ? 'done' : ''}">
    <summary>
      <span class="chev">▶</span>
      <div class="story-title"><h3>${escapeHtml(c.name)}</h3><p>${live ? 'Using synced mission objectives from tarkov.dev cache' : escapeHtml(c.requirement || c.note || 'Story chapter')}</p></div>
      <div class="task-badges"><span class="badge ${status === 'done' ? 'green' : status === 'active' ? 'gold' : ''}">${escapeHtml(status)}</span><span class="badge">${objectives.length} steps</span>${live ? '<span class="badge cyan">synced</span>' : '<span class="badge gold">fallback</span>'}</div>
    </summary>
    <div class="story-body">
      <p>${escapeHtml(live ? 'This chapter matched a synced task. If the game updates, use Sync Tarkov Data again.' : (c.note || 'Fallback summary. Use the wiki button for exact screenshots and newest patch changes.'))}</p>
      ${live?.wikiLink ? `<a href="${escapeHtml(live.wikiLink)}" target="_blank" rel="noreferrer">Open task wiki guide</a>` : c.wiki ? `<a href="${escapeHtml(c.wiki)}" target="_blank" rel="noreferrer">Open live wiki guide</a>` : ''}
      <ul class="objective-list">${objectives.map((o,idx) => `<li><input type="checkbox" ${progress.steps?.[idx] ? 'checked' : ''} onchange="setStoryStep('${c.id}', ${idx}, this.checked)"><span>${escapeHtml(o)}</span></li>`).join('') || '<li>No objectives cached for this chapter yet.</li>'}</ul>
      ${items.length ? `<h4>Items to keep/check</h4><div class="req-list">${uniqueByName(items).map(i => `<span class="req-chip">${escapeHtml(i.count || 1)} × ${escapeHtml(i.name)}${i.note ? ` — ${escapeHtml(i.note)}` : ''}</span>`).join('')}</div>` : ''}
      ${keys.length ? `<h4>Keys / access notes</h4><div class="req-list">${uniqueByName(keys).map(k => `<span class="req-chip">🔑 ${escapeHtml(k.name)}${k.map ? ` • ${escapeHtml(k.map)}` : ''}${k.note ? ` — ${escapeHtml(k.note)}` : ''}</span>`).join('')}</div>` : ''}
      <div class="task-actions-row"><button class="small" onclick="setStoryStatus('${c.id}','active')">Set active</button><button class="small success" onclick="setStoryStatus('${c.id}','done')">Complete</button><button class="small ghost" onclick="setStoryStatus('${c.id}','todo')">Reset</button>${items.length ? `<button class="small" onclick="trackStoryItems('${c.id}')">Track story items</button>` : ''}${keys.length ? `<button class="small" onclick="trackStoryKeys('${c.id}')">Track story keys</button>` : ''}${live ? `<button class="small" onclick="selectStoryMission('${live.id}')">Open in Missions</button>` : ''}</div>
    </div>
  </details>`;
}

window.selectStoryMission = function(taskId) {
  state.appPrefs.selectedTaskId = taskId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-page="tasks"]')?.classList.add('active');
  $('tasks')?.classList.add('active');
  render();
};

function renderLocalMapBoard(map, extracts, locks, bosses, keys) {
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const upload = state.mapImages?.[mapId];
  const asset = selectedMapAsset(map);
  const img = upload || asset?.file || '';
  const title = upload ? 'Uploaded browser image' : asset ? asset.label : 'Schematic mode';
  return `<div class="panel local-map-panel">
    <div class="local-map-head">
      <div><h2>Offline map board</h2><p>The map image now fits the page width. Scroll inside the image box for very large maps.</p></div>
      <span class="pill">${escapeHtml(title)}</span>
    </div>
    ${renderMapAssetSelector(map, asset)}
    <div class="map-image-stage ${img ? 'has-image' : ''}">
      ${img ? `<img class="local-map-img" loading="lazy" decoding="async" src="${escapeHtml(img)}" alt="${escapeHtml(map.name)} map">` : `<div class="map-watermark"><div><strong>${escapeHtml(map.name)}</strong><span>No local map image included yet.</span></div></div>`}
    </div>
    <div class="map-summary-strip"><span>${extracts.length} extracts in cache</span><span>${keys.length} key/lock notes</span><span>${bosses.length} boss entries</span><span>${asset?.width && asset?.height ? `${asset.width}×${asset.height}` : 'browser local'}</span></div>
    <div class="legend"><span>Use variant dropdown for stash/key/3D maps</span><span>Interactive links stay available when you need live markers</span></div>
  </div>`;
}

window.setHideoutLevel = function(id, level) {
  ensureStateShape();
  state.hideoutProgress[id] = Number(level || 0);
  saveState();
};
window.trackHideoutStation = function(id) {
  ensureStateShape();
  const station = getHideoutStations().find(s => hideoutStationId(s) === id);
  const next = station && hideoutNextLevel(station);
  if (!next) return toast('No next level requirements found for this station.');
  let added = 0;
  hideoutReqItems(next).forEach(i => { addTrackerItem(i.name, i.count, 'hideout', `${station.name} level ${next.level}`); added++; });
  saveState(); toast(`Added ${added} hideout item(s) to tracker.`);
};
function importHideoutNeeds() {
  ensureStateShape();
  let added=0;
  getHideoutStations().forEach(s => { const next=hideoutNextLevel(s); if (!next) return; hideoutReqItems(next).forEach(i => { addTrackerItem(i.name, i.count, 'hideout', `${s.name} level ${next.level}`); added++; }); });
  saveState(); toast(`Imported ${added} next-upgrade hideout requirements.`);
}

function wireEvents() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const page = $(btn.dataset.page);
      if (page) page.classList.add('active');
      render();
    };
  });
  const debounced = debounce(render, 180);
  ['searchInput','mapSearch','keySearch','lockerSearch','taskSearch','storySearch','hideoutSearch'].forEach(id => { const el=$(id); if (el) el.oninput = debounced; });
  ['filterSelect','keyMapFilter','lockerFilter','lockerMapFilter','taskTraderFilter','hideoutFilter'].forEach(id => { const el=$(id); if (el) el.onchange = render; });
  if ($('mapSelect')) $('mapSelect').onchange = e => { activeMap = e.target.value; renderMaps(); };
  if ($('customForm')) $('customForm').onsubmit = addCustomItem;
  if ($('manualKeyForm')) $('manualKeyForm').onsubmit = addManualKey;
  if ($('loadPresetBtn')) $('loadPresetBtn').onclick = loadPresets;
  if ($('extractBtn')) $('extractBtn').onclick = safeExtract; if ($('dashExtractBtn')) $('dashExtractBtn').onclick = safeExtract;
  if ($('deathBtn')) $('deathBtn').onclick = lostRaid; if ($('dashDeathBtn')) $('dashDeathBtn').onclick = lostRaid;
  if ($('exportBtn')) $('exportBtn').onclick = exportSave;
  if ($('importInput')) $('importInput').onchange = e => e.target.files[0] && importSave(e.target.files[0]);
  if ($('resetBtn')) $('resetBtn').onclick = resetAll;
  if ($('syncBtn')) $('syncBtn').onclick = syncTarkovData; if ($('syncBtn2')) $('syncBtn2').onclick = syncTarkovData;
  if ($('clearApiCacheBtn')) $('clearApiCacheBtn').onclick = clearApiCache;
  if ($('importFirTasksBtn')) $('importFirTasksBtn').onclick = () => importTaskItems(true);
  if ($('importAllTasksBtn')) $('importAllTasksBtn').onclick = () => importTaskItems(false);
  if ($('importHideoutBtn')) $('importHideoutBtn').onclick = importHideoutNeeds;
}

function render() {
  ensureStateShape();
  const active = activePageId();
  renderStats();
  if (active === 'dashboard') renderTrackedList();
  if (active === 'needed') renderItems();
  if (active === 'raid') renderRaidBag();
  if (active === 'maps') renderMaps();
  if (active === 'keys') renderKeys();
  if (active === 'keylocker') renderKeyLocker();
  if (active === 'hideout') renderHideout();
  if (active === 'tasks') renderTasks();
  if (active === 'story') renderStory();
  if (active === 'data') renderSyncStatus();
  applyTips();
}

ensureStateShape();
wireEvents();
render();

/* ===== v9 map pack + interactive map viewer overrides ===== */
let mapViewerRuntime = { key: '', zoom: 1, x: 0, y: 0, fitZoom: 1, dragging: false, moved: false, addMarkerMode: false, showMarkers: true, lastX: 0, lastY: 0 };

function allMapAssets() {
  return MAP_ASSETS || [];
}

function ensureV9State() {
  ensureStateShape();
  state.mapViewPrefs = state.mapViewPrefs || {};
  state.mapMarkers = state.mapMarkers || {};
  state.appPrefs = state.appPrefs || {};
}

function knownMapAssets(map) {
  const id = normalizeMapId(map?.normalizedName || map?.id || map?.name || activeMap);
  return allMapAssets().filter(a => normalizeMapId(a.mapId) === id);
}

function selectedMapAsset(map) {
  const id = normalizeMapId(map?.normalizedName || map?.id || map?.name || activeMap);
  const assets = knownMapAssets(map);
  const wanted = state.mapAssetChoice?.[id];
  return assets.find(a => a.file === wanted) || assets.find(a => !/mobile/i.test(a.label || a.file || '')) || assets[0] || null;
}

function renderMapAssetSelector(map, selected) {
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const assets = knownMapAssets(map);
  if (!assets.length) return '<p class="meta">No local image pack for this map yet. You can upload one and it will be saved in this browser.</p>';
  return `<label class="map-variant-label">Map image variant
    <select class="map-variant-select" onchange="setMapAssetChoice('${mapId}', this.value)">
      ${assets.map(a => `<option value="${escapeHtml(a.file)}" ${selected?.file === a.file ? 'selected' : ''}>${escapeHtml(a.label)}${a.width && a.height ? ` • ${a.width}×${a.height}` : ''}</option>`).join('')}
    </select>
  </label>`;
}

function renderLocalMapBoard(map, extracts, locks, bosses, keys) {
  ensureV9State();
  const mapId = normalizeMapId(map.normalizedName || map.id || map.name);
  const upload = state.mapImages?.[mapId];
  const asset = selectedMapAsset(map);
  const img = upload || asset?.file || '';
  const viewKey = `${mapId}|${upload ? 'upload' : asset?.file || 'none'}`;
  const title = upload ? 'Uploaded browser image' : asset ? asset.label : 'Schematic mode';
  const markers = state.mapMarkers?.[mapId]?.length || 0;
  return `<div class="panel local-map-panel v9-map-panel">
    <div class="local-map-head">
      <div>
        <div class="kicker">OFFLINE MAP BOARD</div>
        <h2>${escapeHtml(map.name)}</h2>
        <p>High-res local map viewer. Mouse wheel zooms, left-click drag pans, and your view is remembered per map variant.</p>
      </div>
      <span class="pill">${escapeHtml(title)}</span>
    </div>
    ${renderMapAssetSelector(map, asset)}
    <div class="map-tools-v9">
      <button class="small" onclick="mapZoomButton(-0.2)">− Zoom</button>
      <button class="small" onclick="mapZoomButton(0.2)">+ Zoom</button>
      <button class="small" onclick="mapFit()">Fit</button>
      <button class="small" onclick="mapActualSize()">1:1</button>
      <button class="small" onclick="mapResetView()">Reset view</button>
      <button class="small" onclick="toggleMapMarkerMode()" id="markerModeBtn">Add marker</button>
      <button class="small" onclick="toggleMapMarkers()" id="toggleMarkersBtn">Hide markers</button>
      <button class="small" onclick="toggleMapFullscreen()">Fullscreen</button>
      ${img ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(img)}">Open image</a>` : ''}
      <span class="map-zoom-readout" id="mapZoomReadout">Zoom: --</span>
    </div>
    <div class="map-image-stage v9-stage ${img ? 'has-image' : ''}" id="mapViewport" data-map-id="${escapeHtml(mapId)}" data-view-key="${escapeHtml(viewKey)}">
      ${img ? `<div class="map-canvas" id="mapCanvas"><img id="localMapImg" class="local-map-img-v9" loading="eager" decoding="async" src="${escapeHtml(img)}" alt="${escapeHtml(map.name)} map" onload="initMapViewer(true)"><div id="mapMarkerLayer" class="map-marker-layer"></div></div>` : `<div class="map-watermark"><div><strong>${escapeHtml(map.name)}</strong><span>No local map image included yet.</span></div></div>`}
    </div>
    <div class="map-summary-strip"><span>${extracts.length} extracts in cache</span><span>${keys.length} key/lock notes</span><span>${bosses.length} boss entries</span><span>${markers} personal marker${markers === 1 ? '' : 's'}</span><span>${asset?.width && asset?.height ? `${asset.width}×${asset.height}` : 'browser local'}</span></div>
    <div class="legend"><span>Wheel = zoom</span><span>Drag = pan</span><span>Add marker = click the map and name your pin</span><span>Zoom past 100% can only be as sharp as the source image allows</span></div>
  </div>`;
}

function getMapViewKey() {
  const vp = $('mapViewport');
  return vp?.dataset?.viewKey || `${normalizeMapId(activeMap || '')}|unknown`;
}
function getActiveMapIdFromViewer() {
  const vp = $('mapViewport');
  return vp?.dataset?.mapId || normalizeMapId(activeMap || '');
}
function calcFitZoom() {
  const vp = $('mapViewport'), img = $('localMapImg');
  if (!vp || !img || !img.naturalWidth || !img.naturalHeight) return 1;
  return Math.min(vp.clientWidth / img.naturalWidth, vp.clientHeight / img.naturalHeight, 1) || 1;
}
function centeredXY(zoom) {
  const vp = $('mapViewport'), img = $('localMapImg');
  if (!vp || !img) return { x: 0, y: 0 };
  return {
    x: Math.max(0, (vp.clientWidth - img.naturalWidth * zoom) / 2),
    y: Math.max(0, (vp.clientHeight - img.naturalHeight * zoom) / 2)
  };
}
function saveMapView() {
  ensureV9State();
  const key = getMapViewKey();
  state.mapViewPrefs[key] = { zoom: mapViewerRuntime.zoom, x: mapViewerRuntime.x, y: mapViewerRuntime.y, updatedAt: new Date().toISOString() };
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function applyMapTransform() {
  const canvas = $('mapCanvas');
  if (!canvas) return;
  canvas.style.transform = `translate3d(${mapViewerRuntime.x}px, ${mapViewerRuntime.y}px, 0) scale(${mapViewerRuntime.zoom})`;
  const readout = $('mapZoomReadout');
  if (readout) readout.textContent = `Zoom: ${Math.round(mapViewerRuntime.zoom * 100)}%`;
}
function renderMapMarkersLayer() {
  const layer = $('mapMarkerLayer');
  const img = $('localMapImg');
  if (!layer || !img) return;
  const mapId = getActiveMapIdFromViewer();
  const markers = state.mapMarkers?.[mapId] || [];
  layer.innerHTML = mapViewerRuntime.showMarkers ? markers.map((m, idx) => `<button class="user-map-marker ${escapeHtml(m.type || 'note')}" style="left:${Number(m.xPct)}%;top:${Number(m.yPct)}%;" title="${escapeHtml(m.label)}" onclick="deleteMapMarker(event, ${idx})"><span>${escapeHtml(m.label)}</span></button>`).join('') : '';
}

window.initMapViewer = function(forceFit = false) {
  ensureV9State();
  const vp = $('mapViewport'), img = $('localMapImg'), canvas = $('mapCanvas');
  if (!vp || !img || !canvas || !img.naturalWidth) return;
  canvas.style.width = `${img.naturalWidth}px`;
  canvas.style.height = `${img.naturalHeight}px`;
  mapViewerRuntime.key = getMapViewKey();
  mapViewerRuntime.fitZoom = calcFitZoom();
  const saved = state.mapViewPrefs?.[mapViewerRuntime.key];
  if (saved && !forceFit) {
    mapViewerRuntime.zoom = Number(saved.zoom || mapViewerRuntime.fitZoom);
    mapViewerRuntime.x = Number(saved.x || 0);
    mapViewerRuntime.y = Number(saved.y || 0);
  } else if (saved && forceFit && saved.zoom) {
    mapViewerRuntime.zoom = Number(saved.zoom);
    mapViewerRuntime.x = Number(saved.x || 0);
    mapViewerRuntime.y = Number(saved.y || 0);
  } else {
    mapViewerRuntime.zoom = mapViewerRuntime.fitZoom;
    Object.assign(mapViewerRuntime, centeredXY(mapViewerRuntime.zoom));
  }
  applyMapTransform();
  renderMapMarkersLayer();
  wireMapViewerEvents();
};

function wireMapViewerEvents() {
  const vp = $('mapViewport');
  if (!vp || vp.dataset.v9Wired === '1') return;
  vp.dataset.v9Wired = '1';
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.16 : -0.16;
    zoomAt(delta, e.clientX, e.clientY);
  }, { passive: false });
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    vp.setPointerCapture?.(e.pointerId);
    mapViewerRuntime.dragging = true;
    mapViewerRuntime.moved = false;
    mapViewerRuntime.lastX = e.clientX;
    mapViewerRuntime.lastY = e.clientY;
    vp.classList.add('dragging');
  });
  vp.addEventListener('pointermove', e => {
    if (!mapViewerRuntime.dragging) return;
    const dx = e.clientX - mapViewerRuntime.lastX;
    const dy = e.clientY - mapViewerRuntime.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) mapViewerRuntime.moved = true;
    mapViewerRuntime.x += dx;
    mapViewerRuntime.y += dy;
    mapViewerRuntime.lastX = e.clientX;
    mapViewerRuntime.lastY = e.clientY;
    applyMapTransform();
  });
  vp.addEventListener('pointerup', e => {
    const wasMarkerClick = mapViewerRuntime.addMarkerMode && !mapViewerRuntime.moved;
    mapViewerRuntime.dragging = false;
    vp.classList.remove('dragging');
    if (wasMarkerClick) addMapMarkerFromPointer(e);
    saveMapView();
  });
  vp.addEventListener('pointercancel', () => { mapViewerRuntime.dragging = false; vp.classList.remove('dragging'); saveMapView(); });
}

function zoomAt(delta, clientX, clientY) {
  const vp = $('mapViewport');
  if (!vp) return;
  const rect = vp.getBoundingClientRect();
  const oldZoom = mapViewerRuntime.zoom;
  const newZoom = Math.max(0.04, Math.min(4, oldZoom * (1 + delta)));
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;
  const imgX = (cx - mapViewerRuntime.x) / oldZoom;
  const imgY = (cy - mapViewerRuntime.y) / oldZoom;
  mapViewerRuntime.zoom = newZoom;
  mapViewerRuntime.x = cx - imgX * newZoom;
  mapViewerRuntime.y = cy - imgY * newZoom;
  applyMapTransform();
  saveMapView();
}
window.mapZoomButton = function(delta) {
  const vp = $('mapViewport');
  if (!vp) return;
  const rect = vp.getBoundingClientRect();
  zoomAt(delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
};
window.mapFit = function() {
  mapViewerRuntime.zoom = calcFitZoom();
  Object.assign(mapViewerRuntime, centeredXY(mapViewerRuntime.zoom));
  applyMapTransform(); saveMapView();
};
window.mapActualSize = function() {
  const vp = $('mapViewport');
  mapViewerRuntime.zoom = 1;
  mapViewerRuntime.x = 20;
  mapViewerRuntime.y = 20;
  if (vp) { mapViewerRuntime.x = Math.min(20, vp.clientWidth / 2); mapViewerRuntime.y = Math.min(20, vp.clientHeight / 2); }
  applyMapTransform(); saveMapView();
};
window.mapResetView = function() {
  ensureV9State();
  delete state.mapViewPrefs[getMapViewKey()];
  mapFit();
  toast('Map view reset.');
};
window.toggleMapFullscreen = function() {
  const panel = document.querySelector('.v9-map-panel');
  if (!panel) return;
  if (!document.fullscreenElement) panel.requestFullscreen?.(); else document.exitFullscreen?.();
  setTimeout(() => { mapFit(); }, 180);
};
window.toggleMapMarkerMode = function() {
  mapViewerRuntime.addMarkerMode = !mapViewerRuntime.addMarkerMode;
  const btn = $('markerModeBtn');
  if (btn) btn.textContent = mapViewerRuntime.addMarkerMode ? 'Marker mode: ON' : 'Add marker';
  const vp = $('mapViewport');
  if (vp) vp.classList.toggle('marker-mode', mapViewerRuntime.addMarkerMode);
  toast(mapViewerRuntime.addMarkerMode ? 'Marker mode on: click the map to drop a pin.' : 'Marker mode off.');
};
window.toggleMapMarkers = function() {
  mapViewerRuntime.showMarkers = !mapViewerRuntime.showMarkers;
  const btn = $('toggleMarkersBtn');
  if (btn) btn.textContent = mapViewerRuntime.showMarkers ? 'Hide markers' : 'Show markers';
  renderMapMarkersLayer();
};
function addMapMarkerFromPointer(e) {
  const img = $('localMapImg'), vp = $('mapViewport');
  if (!img || !vp) return;
  const label = prompt('Marker name, e.g. Quest item, Stash, Sniper, Extract');
  if (!label) return;
  const rect = vp.getBoundingClientRect();
  const localX = (e.clientX - rect.left - mapViewerRuntime.x) / mapViewerRuntime.zoom;
  const localY = (e.clientY - rect.top - mapViewerRuntime.y) / mapViewerRuntime.zoom;
  const xPct = Math.max(0, Math.min(100, (localX / img.naturalWidth) * 100));
  const yPct = Math.max(0, Math.min(100, (localY / img.naturalHeight) * 100));
  const mapId = getActiveMapIdFromViewer();
  state.mapMarkers[mapId] = state.mapMarkers[mapId] || [];
  state.mapMarkers[mapId].push({ label, xPct: Number(xPct.toFixed(3)), yPct: Number(yPct.toFixed(3)), type: 'note', createdAt: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderMapMarkersLayer();
  toast('Map marker saved. Click the marker later to delete it.');
}
window.deleteMapMarker = function(event, idx) {
  event.stopPropagation();
  const mapId = getActiveMapIdFromViewer();
  const marker = state.mapMarkers?.[mapId]?.[idx];
  if (!marker) return;
  if (!confirm(`Delete marker: ${marker.label}?`)) return;
  state.mapMarkers[mapId].splice(idx, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  renderMapMarkersLayer();
  toast('Marker deleted.');
};

// Re-render using the v9 overrides after the original app has initialised.
try { ensureV9State(); render(); } catch (err) { console.warn('v9 map viewer init skipped', err); }

/* ===== v10 key wiki lock-location enrichment ===== */
const KEY_INTEL_VERSION = 'v10';
const GENERIC_KEY_NOTES = [
  'key synced from tarkov.dev',
  'mission objectives may also include',
  'use mission detection',
  'no usage note in cache',
  'try syncing'
];

function ensureV10State() {
  ensureV9State?.();
  state.keyIntel = state.keyIntel || {};
  state.appPrefs = state.appPrefs || {};
}

function mapAliases() {
  return [
    ['Shoreline', ['shoreline', 'health resort', 'resort', 'sanatorium', 'azure coast']],
    ['Customs', ['customs', 'dorm', 'dorms', 'tarcone', 'big red', 'trailer park', 'gas station', 'portable cabin', 'checkpoint', 'machinery key', 'unknown key']],
    ['Factory', ['factory', 'pumping station', 'emergency exit key', 'factory emergency']],
    ['Woods', ['woods', 'zb-014', 'shturman', 'sawmill', 'prapor convoy', 'usec camp']],
    ['Reserve', ['reserve', 'bunker', 'rb-', 'rb-', 'black pawn', 'white pawn', 'black knight', 'white knight', 'queen', 'king building', 'bishop']],
    ['Interchange', ['interchange', 'ultra', 'kiba', 'oli ', 'goshan', 'idea ', 'emercom', 'power substation', 'object #', 'pharmacy key']],
    ['The Lab', ['the lab', 'laboratory', 'terra group labs', 'terragroup labs', 'lab keycard', 'keycard', 'manager office', 'weapon testing', 'parking gate', 'hangar gate']],
    ['Lighthouse', ['lighthouse', 'water treatment', 'rogue', 'merin', 'hillside', 'cottage', 'usec stash', 'conference room', 'operating room']],
    ['Streets of Tarkov', ['streets of tarkov', 'streets', 'concordia', 'chekannaya', 'beluga', 'primorsky', 'aspect', 'car dealership', 'tarbank', 'post office', 'relaxation room', 'abandoned factory', 'zmeevsky']],
    ['Ground Zero', ['ground zero', 'terragroup science office', 'science office', 'fusion', 'unity credit bank', 'emergency services academy']],
    ['Terminal', ['terminal']],
    ['Icebreaker', ['icebreaker']],
    ['The Labyrinth', ['labyrinth']]
  ];
}

function inferMapFromText(text) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return '';
  for (const [map, aliases] of mapAliases()) {
    if (aliases.some(a => hay.includes(a))) return map;
  }
  return '';
}

function isGenericKeyLocation(text) {
  const s = String(text || '').toLowerCase();
  return !s || GENERIC_KEY_NOTES.some(g => s.includes(g));
}

function wikiTitleFromKey(key) {
  if (key?.wikiLink) {
    const m = String(key.wikiLink).match(/\/wiki\/([^?#]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return String(key?.name || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/'/g, '%27');
}

function wikiUrlFromKey(key) {
  if (key?.wikiLink) return key.wikiLink;
  return `https://escapefromtarkov.fandom.com/wiki/${wikiTitleFromKey(key)}`;
}

function wikiApiUrlForTitle(title) {
  return `https://escapefromtarkov.fandom.com/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text%7Csections&format=json&redirects=true&origin=*`;
}

function extractSectionFromWikiHtml(html, heading) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const want = String(heading).toLowerCase();
  const spans = [...doc.querySelectorAll('.mw-headline, span[id]')];
  const span = spans.find(s => String(s.textContent || '').trim().toLowerCase() === want || String(s.id || '').replace(/_/g, ' ').toLowerCase() === want);
  const header = span?.closest('h2,h3,h4');
  if (!header) return '';
  const parts = [];
  let node = header.nextElementSibling;
  while (node && !['H2','H3'].includes(node.tagName)) {
    if (['P','UL','OL','DL','TABLE','DIV'].includes(node.tagName)) {
      const text = (node.innerText || node.textContent || '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
    node = node.nextElementSibling;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function sentenceFromKeyName(key) {
  const name = String(key?.name || '');
  if (/health resort/i.test(name)) {
    const wing = /west wing/i.test(name) ? 'West Wing' : /east wing/i.test(name) ? 'East Wing' : 'Health Resort';
    const room = name.match(/room\s*(\d+)/i)?.[1];
    const floor = room ? `${room[0] === '1' ? 'first' : room[0] === '2' ? 'second' : room[0] === '3' ? 'third' : room[0] + 'th'} floor, room ${room}` : wing;
    return `The ${floor} of the ${wing} in the Health Resort on Shoreline.`;
  }
  if (/dorm room/i.test(name)) {
    const room = name.match(/room\s*(\d+)/i)?.[1];
    return `Dorms${room ? ` room ${room}` : ''} on Customs.`;
  }
  if (/factory.*emergency|emergency.*factory/i.test(name)) return 'Factory emergency exits on Factory.';
  if (/pumping station/i.test(name)) return 'Pumping station on Factory.';
  if (/RB[-\s]/i.test(name) || /^RB/i.test(name)) return 'Reserve military base lock location. Exact room should be enriched from wiki.';
  if (/KIBA|ULTRA|OLI|Goshan|IDEA|EMERCOM/i.test(name)) return 'Interchange lock location. Exact shop/room should be enriched from wiki.';
  return '';
}

function mergeKeyIntel(key) {
  ensureV10State();
  const id = keyId(key?.name || '');
  const intel = state.keyIntel[id] || {};
  const heuristic = sentenceFromKeyName(key);
  const baseLocation = !isGenericKeyLocation(key?.location) ? key.location : '';
  const location = intel.lockLocation || baseLocation || heuristic || key?.description || '';
  const keyLocation = intel.keyLocation || '';
  const behindLock = intel.behindLock || '';
  const mapGuess = intel.map || inferMapFromText([location, keyLocation, key?.name, key?.description, (key?.maps || []).join(' ')].join(' '));
  const maps = [...new Set([...(key?.maps || []), key?.map, mapGuess].filter(Boolean))];
  return { ...key, maps, map: maps[0] || key?.map || '', location, keyLocation, behindLock, wikiEnrichedAt: intel.enrichedAt, wikiError: intel.error, wikiLink: key?.wikiLink || wikiUrlFromKey(key) };
}

function allKnownKeys() {
  ensureV10State();
  const apiKeys = (state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS).map(k => mergeKeyIntel({ ...k, manual: false }));
  const byId = new Map(apiKeys.map(k => [keyId(k.name), k]));
  Object.values(state.keyLocker || {}).forEach(k => {
    const id = keyId(k.name);
    const merged = mergeKeyIntel({ name: k.name, maps: k.map ? [k.map] : [], location: k.notes || '', manual: true });
    if (!byId.has(id)) byId.set(id, merged);
  });
  return [...byId.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
}

function filteredKeysForPage() {
  const keys = allKnownKeys();
  const q = ($('keySearch')?.value || '').toLowerCase();
  const mf = $('keyMapFilter')?.value || 'all';
  return keys.filter(k => {
    const info = mergeKeyIntel(k);
    const mapsText = (info.maps || [info.map]).filter(Boolean).join(' ');
    const text = `${info.name} ${info.shortName || ''} ${mapsText} ${info.location || ''} ${info.keyLocation || ''} ${info.behindLock || ''} ${info.description || ''}`.toLowerCase();
    return (!q || text.includes(q)) && (mf === 'all' || (info.maps || [info.map]).includes(mf));
  });
}

function keyIntelToolsHtml(filteredCount, totalCount) {
  const enriched = Object.values(state.keyIntel || {}).filter(v => v?.lockLocation || v?.keyLocation).length;
  return `<div class="panel action-panel key-intel-panel">
    <div><strong>Wiki lock-location lookup</strong><p class="meta">tarkov.dev gives the key item list, but many key items do not include the wiki Lock Location field. Use this to pull Lock Location / Key Location from the Tarkov Wiki and cache it locally.</p></div>
    <div class="card-actions">
      <button onclick="enrichVisibleKeysFromWiki()">Enrich visible keys from wiki</button>
      <button onclick="enrichAllKeysFromWiki()">Enrich all keys slowly</button>
      <button class="ghost" onclick="clearWikiKeyIntel()">Clear wiki key cache</button>
    </div>
    <p id="keyEnrichStatus" class="meta">Visible: ${filteredCount} / ${totalCount} keys • Wiki enriched cache: ${enriched}</p>
  </div>`;
}

function renderKeys() {
  ensureV10State();
  const list = $('keysList');
  if (!list) return;
  const keys = allKnownKeys();
  const mapFilter = $('keyMapFilter');
  if (mapFilter) {
    const mapNames = [...new Set(keys.flatMap(k => (mergeKeyIntel(k).maps || [k.map]).filter(Boolean)).concat(MAP_LINKS.map(m => m.name)))].sort();
    const oldVal = mapFilter.value || 'all';
    mapFilter.innerHTML = '<option value="all">All maps</option>' + mapNames.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    mapFilter.value = [...mapFilter.options].some(o => o.value === oldVal) ? oldVal : 'all';
  }
  const filtered = filteredKeysForPage();
  list.innerHTML = keyIntelToolsHtml(filtered.length, keys.length) + (filtered.length ? filtered.map(k0 => {
    const k = mergeKeyIntel(k0);
    const locker = getLockerEntry(k);
    const statusText = locker.status === 'owned' ? `Owned${locker.qty ? ` x${locker.qty}` : ''}` : locker.status === 'needed' ? 'Needed' : 'Not marked';
    const safe = escapeHtml(k.name).replace(/'/g, "&#39;");
    const mapsText = (k.maps || [k.map]).filter(Boolean).join(', ') || 'Map unknown';
    const wikiTag = k.wikiEnrichedAt ? '<span class="badge green">wiki lock location cached</span>' : k.location && !isGenericKeyLocation(k.location) ? '<span class="badge gold">smart guess / synced</span>' : '<span class="badge">not enriched</span>';
    return `<article class="card key-card">
      <div class="card-head"><div><h3>${escapeHtml(k.name)}</h3><p class="meta">${escapeHtml(mapsText)}</p></div><span class="pill">${escapeHtml(statusText)}</span></div>
      <p><strong>Lock/use:</strong> ${escapeHtml(k.location || 'No lock location cached yet.')}</p>
      ${k.keyLocation ? `<p><strong>Key spawns:</strong> ${escapeHtml(k.keyLocation)}</p>` : ''}
      ${k.behindLock ? `<p><strong>Behind lock:</strong> ${escapeHtml(k.behindLock)}</p>` : ''}
      <div class="req-list">${wikiTag}${(k.usedInTasks || []).length ? `<span class="badge cyan">Used in: ${escapeHtml((k.usedInTasks || []).slice(0,3).join(', '))}</span>` : ''}${k.wikiError ? `<span class="badge red">wiki error: ${escapeHtml(k.wikiError)}</span>` : ''}</div>
      <div class="card-actions">
        <button onclick="addKeyToTracker('${safe}')">Track key</button>
        ${keyStatusButtons(k.name, locker)}
        <button onclick="enrichOneKeyFromWiki('${safe}')">Wiki lock lookup</button>
        ${k.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(k.wikiLink)}">Wiki</a>` : ''}
      </div>
    </article>`;
  }).join('') : '<div class="panel"><p>No keys found.</p></div>');
}

function renderKeyLocker() {
  ensureV10State();
  const list = $('lockerList');
  if (!list) return;
  const mapFilter = $('lockerMapFilter');
  const keys = allKnownKeys();
  const mapNames = [...new Set(keys.flatMap(k => (mergeKeyIntel(k).maps || [k.map]).filter(Boolean)).concat(Object.values(state.keyLocker || {}).map(k => k.map).filter(Boolean)))].sort();
  if (mapFilter) {
    const oldVal = mapFilter.value || 'all';
    mapFilter.innerHTML = '<option value="all">All maps</option>' + mapNames.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    mapFilter.value = [...mapFilter.options].some(o => o.value === oldVal) ? oldVal : 'all';
  }
  const q = ($('lockerSearch')?.value || '').toLowerCase();
  const statusFilter = $('lockerFilter')?.value || 'all';
  const mf = mapFilter?.value || 'all';
  const entries = keys.map(k => ({ key: mergeKeyIntel(k), entry: getLockerEntry(k) }));
  const owned = entries.filter(e => e.entry.status === 'owned').length;
  const needed = entries.filter(e => e.entry.status === 'needed').length;
  const missing = entries.filter(e => e.entry.status === 'needed' && Number(e.entry.qty || 0) <= 0).length;
  if ($('lockerSummary')) $('lockerSummary').innerHTML = `<div class="stats inline-stats"><div class="stat"><strong>${owned}</strong><span>owned keys</span></div><div class="stat"><strong>${needed}</strong><span>needed keys</span></div><div class="stat"><strong>${missing}</strong><span>still missing</span></div><div class="stat"><strong>${keys.length}</strong><span>known keys</span></div></div>`;
  const filtered = entries.filter(({key:k, entry}) => {
    const maps = (k.maps || [k.map, entry.map]).filter(Boolean);
    const text = `${k.name} ${maps.join(' ')} ${k.location || ''} ${k.keyLocation || ''} ${k.behindLock || ''} ${entry.notes || ''}`.toLowerCase();
    const statusOk = statusFilter === 'all' || (statusFilter === 'missing' ? entry.status === 'needed' && Number(entry.qty || 0) <= 0 : statusFilter === 'unused' ? !entry.status || entry.status === 'unused' : entry.status === statusFilter);
    return (!q || text.includes(q)) && statusOk && (mf === 'all' || maps.includes(mf));
  });
  list.innerHTML = filtered.length ? filtered.map(({key:k, entry}) => {
    const maps = (k.maps || [k.map, entry.map]).filter(Boolean);
    const safe = escapeHtml(k.name).replace(/'/g, "&#39;");
    const status = entry.status === 'owned' ? `Owned x${entry.qty || 1}` : entry.status === 'needed' ? 'Needed' : 'Not marked';
    const note = entry.notes || k.location || k.description || 'No note yet.';
    return `<article class="card key-locker-card">
      <div class="card-head"><div><h3>${escapeHtml(k.name)}</h3><p class="meta">${escapeHtml(maps.join(', ') || 'Map unknown')}</p></div><span class="pill">${escapeHtml(status)}</span></div>
      <p>${escapeHtml(note)}</p>
      ${k.keyLocation ? `<p class="meta"><strong>Key spawns:</strong> ${escapeHtml(k.keyLocation)}</p>` : ''}
      <div class="qty-row"><span>Owned qty</span><button onclick="changeKeyQty('${safe}', -1)">-</button><strong>${Number(entry.qty || 0)}</strong><button onclick="changeKeyQty('${safe}', 1)">+</button></div>
      <textarea rows="2" placeholder="Your note: spawn, use, who has spare keys..." oninput="updateKeyNote('${safe}', this.value)">${escapeHtml(entry.notes || '')}</textarea>
      <div class="card-actions">${keyStatusButtons(k.name, entry)}<button onclick="addKeyToTracker('${safe}')">Track as item</button><button onclick="enrichOneKeyFromWiki('${safe}')">Wiki lookup</button>${k.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${escapeHtml(k.wikiLink)}">Wiki</a>` : ''}</div>
    </article>`;
  }).join('') : '<div class="panel"><p>No keys match that filter.</p></div>';
}

async function fetchWikiIntelForKey(key) {
  const title = wikiTitleFromKey(key);
  const res = await fetch(wikiApiUrlForTitle(title));
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.info || json.error.code || 'wiki error');
  const html = json?.parse?.text?.['*'] || '';
  const lockLocation = extractSectionFromWikiHtml(html, 'Lock Location');
  const keyLocation = extractSectionFromWikiHtml(html, 'Key Location');
  const behindLock = extractSectionFromWikiHtml(html, 'Behind the Lock');
  const textForMap = [lockLocation, keyLocation, key.name].join(' ');
  return { lockLocation, keyLocation, behindLock, map: inferMapFromText(textForMap), wikiTitle: json?.parse?.title || title, wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(json?.parse?.title || title).replace(/%20/g, '_')}` };
}

function setKeyEnrichStatus(msg) { const el = $('keyEnrichStatus'); if (el) el.textContent = msg; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

window.enrichOneKeyFromWiki = async function(name) {
  ensureV10State();
  const decoded = document.createElement('textarea'); decoded.innerHTML = name; const keyName = decoded.value;
  const key = allKnownKeys().find(k => String(k.name).toLowerCase() === keyName.toLowerCase()) || { name: keyName };
  const id = keyId(keyName);
  setKeyEnrichStatus(`Checking wiki for ${keyName}...`);
  try {
    const intel = await fetchWikiIntelForKey(key);
    state.keyIntel[id] = { ...(state.keyIntel[id] || {}), ...intel, enrichedAt: new Date().toISOString(), error: '' };
    if (intel.wikiLink) {
      const cacheKey = (state.apiCache.keys || []).find(k => keyId(k.name) === id);
      if (cacheKey) cacheKey.wikiLink = cacheKey.wikiLink || intel.wikiLink;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setKeyEnrichStatus(`Saved wiki lock location for ${keyName}.`);
    toast('Wiki key location saved.');
    render();
  } catch (err) {
    state.keyIntel[id] = { ...(state.keyIntel[id] || {}), error: err.message, enrichedAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setKeyEnrichStatus(`Wiki lookup failed for ${keyName}: ${err.message}`);
    toast('Wiki lookup failed. Try the wiki button or check internet/CORS.');
    render();
  }
};

async function enrichKeyBatch(keys, label, maxCount = Infinity) {
  ensureV10State();
  const batch = keys.slice(0, maxCount);
  let ok = 0, fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const k = batch[i];
    const id = keyId(k.name);
    if (state.keyIntel[id]?.lockLocation && state.keyIntel[id]?.keyLocation) { ok++; continue; }
    setKeyEnrichStatus(`${label}: ${i + 1}/${batch.length} — ${k.name}`);
    try {
      const intel = await fetchWikiIntelForKey(k);
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), ...intel, enrichedAt: new Date().toISOString(), error: '' };
      ok++;
    } catch (err) {
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), error: err.message, enrichedAt: new Date().toISOString() };
      fail++;
    }
    if (i % 5 === 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    await delay(180);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  setKeyEnrichStatus(`${label} complete: ${ok} saved, ${fail} failed.`);
  toast(`${label} complete.`);
  render();
}

window.enrichVisibleKeysFromWiki = async function() {
  const keys = filteredKeysForPage();
  if (!keys.length) return toast('No visible keys to enrich.');
  await enrichKeyBatch(keys, 'Visible key wiki lookup', 80);
};
window.enrichAllKeysFromWiki = async function() {
  const keys = allKnownKeys();
  if (!confirm(`This will slowly check the wiki for up to ${keys.length} keys and cache Lock Location / Key Location locally. It may take a few minutes. Continue?`)) return;
  await enrichKeyBatch(keys, 'All key wiki lookup', keys.length);
};
window.clearWikiKeyIntel = function() {
  if (!confirm('Clear cached wiki key Lock Location / Key Location data?')) return;
  state.keyIntel = {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
  toast('Wiki key cache cleared.');
};

// Patch synced keys with smart local guesses straight away, then leave exact wording for wiki enrichment.
const previousSyncTarkovDataV10 = syncTarkovData;
syncTarkovData = async function() {
  await previousSyncTarkovDataV10();
  ensureV10State();
  state.apiCache.keys = (state.apiCache.keys || []).map(k => mergeKeyIntel(k));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
};

try { ensureV10State(); render(); } catch (err) { console.warn('v10 key intel init skipped', err); }

/* ===== v12 quota-safe storage + reliable sync patch =====
   Browser localStorage is usually only around 5MB. Full tarkov.dev mission/hideout
   payloads can go over that, especially with old browser-uploaded map images.
   This patch stores a compact API cache and keeps user progress safe. */
const STORAGE_PATCH_VERSION = 'v12-quota-safe';

function compactRef(x) {
  if (!x) return null;
  return {
    id: x.id || undefined,
    name: x.name || undefined,
    normalizedName: x.normalizedName || undefined,
    shortName: x.shortName || undefined,
    wikiLink: x.wikiLink || undefined
  };
}
function compactMapRef(x) {
  if (!x) return null;
  return { id: x.id || undefined, name: x.name || undefined, normalizedName: x.normalizedName || undefined };
}
function compactKeyForStorage(k) {
  if (!k) return null;
  return {
    id: k.id, name: k.name, normalizedName: k.normalizedName, shortName: k.shortName,
    wikiLink: k.wikiLink, uses: k.uses || null,
    usedInTasks: (k.usedInTasks || []).map(t => typeof t === 'string' ? t : t?.name).filter(Boolean).slice(0, 30),
    maps: k.maps || (k.map ? [k.map] : []), map: k.map || undefined,
    location: k.location || undefined,
    keyLocation: k.keyLocation || undefined,
    behindLock: k.behindLock || undefined,
    source: k.source || 'tarkov.dev API'
  };
}
function compactObjectiveForStorage(o) {
  if (!o) return null;
  const out = {
    id: o.id, type: o.type, description: o.description, optional: !!o.optional,
    count: o.count, foundInRaid: !!o.foundInRaid,
    targetNames: o.targetNames, zoneNames: o.zoneNames, bodyParts: o.bodyParts,
    exitName: o.exitName, playerLevel: o.playerLevel, stationLevel: o.stationLevel,
    maps: (o.maps || []).map(compactMapRef).filter(Boolean),
    zones: (o.zones || []).map(z => ({ map: compactMapRef(z?.map) })).filter(z => z.map),
    possibleLocations: (o.possibleLocations || []).map(p => ({ map: compactMapRef(p?.map) })).filter(p => p.map),
    requiredKeys: (o.requiredKeys || []).map(compactRef).filter(Boolean),
    items: (o.items || []).map(compactRef).filter(Boolean),
    item: compactRef(o.item),
    questItem: compactRef(o.questItem),
    markerItem: compactRef(o.markerItem),
    useAny: (o.useAny || []).map(compactRef).filter(Boolean),
    containsAll: (o.containsAll || []).map(compactRef).filter(Boolean),
    containsCategory: o.containsCategory ? { name: o.containsCategory.name, normalizedName: o.containsCategory.normalizedName } : undefined,
    hideoutStation: compactRef(o.hideoutStation),
    skillLevel: o.skillLevel ? { skill: compactRef(o.skillLevel.skill), level: o.skillLevel.level } : undefined,
    trader: compactRef(o.trader),
    level: o.level,
    task: compactRef(o.task),
    status: o.status
  };
  Object.keys(out).forEach(k => (out[k] === undefined || out[k] === null || (Array.isArray(out[k]) && !out[k].length)) && delete out[k]);
  return out;
}
function compactTaskForStorage(t) {
  if (!t) return null;
  return {
    id: t.id, tarkovDataId: t.tarkovDataId, name: t.name, normalizedName: t.normalizedName,
    minPlayerLevel: t.minPlayerLevel, wikiLink: t.wikiLink,
    kappaRequired: !!t.kappaRequired, lightkeeperRequired: !!t.lightkeeperRequired,
    experience: t.experience,
    trader: compactRef(t.trader),
    map: compactMapRef(t.map),
    taskRequirements: (t.taskRequirements || []).map(r => ({ task: compactRef(r.task), status: r.status })).filter(r => r.task?.name),
    objectives: (t.objectives || []).map(compactObjectiveForStorage).filter(Boolean),
    source: t.source || 'tarkov.dev API'
  };
}
function compactHideoutForStorage(s) {
  if (!s) return null;
  return {
    id: s.id, name: s.name, normalizedName: s.normalizedName,
    levels: (s.levels || []).map(l => ({
      id: l.id, level: l.level, constructionTime: l.constructionTime,
      description: l.description,
      itemRequirements: (l.itemRequirements || []).map(r => ({ id: r.id, count: r.count || r.quantity || 1, quantity: r.quantity, item: compactRef(r.item) })),
      stationLevelRequirements: (l.stationLevelRequirements || []).map(r => ({ id: r.id, level: r.level, station: compactRef(r.station) })),
      skillRequirements: (l.skillRequirements || []).map(r => ({ id: r.id, name: r.name, level: r.level, skill: compactRef(r.skill) })),
      traderRequirements: (l.traderRequirements || []).map(r => ({ id: r.id, value: r.value, requirementType: r.requirementType, compareMethod: r.compareMethod, trader: compactRef(r.trader) }))
    }))
  };
}
function compactMapForStorage(m) {
  if (!m) return null;
  return {
    id: m.id, name: m.name, normalizedName: m.normalizedName,
    wiki: m.wiki, description: m.description,
    raidDuration: m.raidDuration, players: m.players,
    extracts: (m.extracts || []).map(e => ({ id: e.id, name: e.name, faction: e.faction, switches: (e.switches || []).map(s => ({ id:s.id, name:s.name, switchType:s.switchType })) })),
    switches: (m.switches || []).map(s => ({ id:s.id, name:s.name, switchType:s.switchType })),
    bosses: (m.bosses || []).map(b => ({ boss: compactRef(b.boss), spawnChance: b.spawnChance, spawnTrigger: b.spawnTrigger, spawnLocations: (b.spawnLocations || []).map(l => ({ name:l.name, chance:l.chance })) })),
    keys: (m.keys || []).slice(0, 200),
    locks: (m.locks || []).map(l => ({ lockType: l.lockType, needsPower: l.needsPower, key: compactRef(l.key) }))
  };
}
function compactKeyIntelForStorage(src) {
  const out = {};
  Object.entries(src || {}).forEach(([id, v]) => {
    out[id] = {
      lockLocation: v.lockLocation || undefined,
      keyLocation: v.keyLocation || undefined,
      behindLock: v.behindLock || undefined,
      map: v.map || undefined,
      wikiTitle: v.wikiTitle || undefined,
      wikiLink: v.wikiLink || undefined,
      enrichedAt: v.enrichedAt || undefined,
      error: v.error || undefined
    };
  });
  return out;
}
function stateForStorage(level = 1) {
  ensureStateShape();
  const apiCache = state.apiCache || {};
  const compact = {
    ...state,
    // Do not store browser-uploaded map data URLs in localStorage. The included
    // asset map packs still load from assets/maps and map choices are preserved.
    mapImages: {},
    keyIntel: compactKeyIntelForStorage(state.keyIntel),
    apiCache: {
      maps: (apiCache.maps || FALLBACK_MAPS || []).map(compactMapForStorage).filter(Boolean),
      keys: (apiCache.keys || FALLBACK_KEYS || []).map(k => compactKeyForStorage(mergeKeyIntel ? mergeKeyIntel(k) : k)).filter(Boolean),
      tasks: (apiCache.tasks || FALLBACK_TASKS || []).map(compactTaskForStorage).filter(Boolean),
      hideout: (apiCache.hideout || FALLBACK_HIDEOUT_STATIONS || []).map(compactHideoutForStorage).filter(Boolean),
      syncedAt: apiCache.syncedAt || null,
      source: apiCache.source || 'offline fallback',
      storagePatch: STORAGE_PATCH_VERSION
    },
    updatedAt: new Date().toISOString()
  };
  if (level >= 2) {
    // Extra-light fallback if a browser has a tiny quota.
    compact.apiCache.maps.forEach(m => { delete m.description; });
    compact.apiCache.keys.forEach(k => { delete k.description; });
    compact.apiCache.tasks.forEach(t => {
      t.taskRequirements = (t.taskRequirements || []).slice(0, 30);
      (t.objectives || []).forEach(o => { delete o.bodyParts; });
    });
    compact.apiCache.hideout.forEach(s => (s.levels || []).forEach(l => { delete l.description; }));
  }
  if (level >= 3) {
    // Last-resort: keep user progress, use offline fallback for big reference data.
    compact.apiCache = { maps: FALLBACK_MAPS, keys: FALLBACK_KEYS, tasks: FALLBACK_TASKS, hideout: FALLBACK_HIDEOUT_STATIONS, syncedAt: null, source: 'offline fallback - synced cache too large for this browser', storagePatch: STORAGE_PATCH_VERSION };
  }
  return compact;
}
function safePersistState(noRender = false) {
  ensureStateShape();
  state.updatedAt = new Date().toISOString();
  // Free old v2-v8 cache copies that can silently eat the same origin quota.
  try { (LEGACY_STORAGE_KEYS || []).forEach(k => localStorage.removeItem(k)); } catch {}
  let lastErr = null;
  for (let level = 1; level <= 3; level++) {
    try {
      const compact = stateForStorage(level);
      const json = JSON.stringify(compact);
      console.info(`Saving tracker state ${STORAGE_PATCH_VERSION}, compact level ${level}, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
      localStorage.setItem(STORAGE_KEY, json);
      if (!noRender) render();
      return true;
    } catch (err) {
      lastErr = err;
      console.warn(`Save failed at compact level ${level}`, err);
    }
  }
  alert('The tracker could not save because browser storage is full. Export your save, then use Data / Clear synced cache or clear site data for localhost. Your current page memory is still open until you refresh.');
  throw lastErr || new Error('Storage quota exceeded');
}

// Replace all normal saves from this point onward with the quota-safe saver.
saveState = function() { safePersistState(false); };

function setSyncButtonsDisabled(disabled) {
  if ($('syncBtn')) $('syncBtn').disabled = disabled;
  if ($('syncBtn2')) $('syncBtn2').disabled = disabled;
}
function setSyncStatusHtml(html) {
  const status = $('syncStatus');
  if (status) status.innerHTML = html;
}

// Fresh sync function that never tries to store the raw oversized GraphQL payload.
syncTarkovData = async function() {
  ensureStateShape();
  setSyncStatusHtml('<p><strong>Syncing...</strong> Pulling maps, keys, missions and hideout data separately. This version saves a compact cache so browser storage does not fill up.</p>');
  setSyncButtonsDisabled(true);
  const notes = [];
  let maps = state.apiCache.maps?.length ? state.apiCache.maps : FALLBACK_MAPS;
  let keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  let tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  let hideout = state.apiCache.hideout?.length ? state.apiCache.hideout : FALLBACK_HIDEOUT_STATIONS;

  try {
    const data = await gql(`query LocalTrackerMaps($lang: LanguageCode) {
      maps(lang: $lang) {
        id name normalizedName wiki description enemies raidDuration players minPlayerLevel maxPlayerLevel
        extracts { id name faction switches { id name switchType } }
        switches { id name switchType }
        bosses { boss { id name normalizedName } spawnChance spawnTrigger spawnLocations { name chance } }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    maps = (data.maps || []).map(compactMapForStorage).filter(Boolean);
    notes.push(`maps ${maps.length}`);
  } catch (err) {
    console.warn('Map sync failed', err);
    notes.push(`maps failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerKeys($lang: LanguageCode) {
      keys: items(type: keys, lang: $lang) {
        id name normalizedName shortName description wikiLink types iconLink
        properties { ... on ItemPropertiesKey { uses } }
        usedInTasks { id name normalizedName }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    keys = (data.keys || []).map(k => compactKeyForStorage(mergeKeyIntel({
      id: k.id,
      name: k.name,
      normalizedName: k.normalizedName,
      shortName: k.shortName,
      wikiLink: k.wikiLink,
      uses: k.properties?.uses || null,
      usedInTasks: (k.usedInTasks || []).map(t => t.name),
      maps: [],
      location: (k.usedInTasks || []).length ? `Used in missions: ${(k.usedInTasks || []).slice(0, 5).map(t => t.name).join(', ')}` : 'Key synced from tarkov.dev. Use wiki lock lookup for exact Lock Location.',
      source: 'tarkov.dev API'
    }))).filter(Boolean);
    notes.push(`keys ${keys.length}`);
  } catch (err) {
    console.warn('Key sync failed', err);
    notes.push(`keys failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerHideout($lang: LanguageCode) {
      hideoutStations(lang: $lang) {
        id name normalizedName
        levels { id level constructionTime description
          itemRequirements { id count quantity item { id name normalizedName shortName wikiLink } }
          stationLevelRequirements { id level station { id name normalizedName } }
          skillRequirements { id name level skill { id name } }
          traderRequirements { id value requirementType compareMethod trader { id name } }
        }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    hideout = (data.hideoutStations || []).map(compactHideoutForStorage).filter(Boolean);
    notes.push(`hideout ${hideout.length}`);
  } catch (err) {
    console.warn('Hideout sync failed', err);
    notes.push(`hideout failed: ${err.message}`);
  }

  try {
    let data;
    try {
      data = await gql(`query LocalTrackerTasks($lang: LanguageCode) {
        tasks(lang: $lang) {
          id tarkovDataId name normalizedName minPlayerLevel wikiLink kappaRequired lightkeeperRequired experience
          trader { id name normalizedName }
          map { id name normalizedName }
          taskRequirements { task { id name normalizedName } status }
          objectives {
            id type description optional maps { id name normalizedName }
            ... on TaskObjectiveBasic { requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveItem { items { id name normalizedName shortName wikiLink } count foundInRaid dogTagLevel maxDurability minDurability requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveQuestItem { questItem { id name normalizedName shortName } count possibleLocations { map { id name normalizedName } } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveShoot { targetNames count zoneNames bodyParts requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveMark { markerItem { id name normalizedName shortName wikiLink } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveUseItem { useAny { id name normalizedName shortName wikiLink } count zoneNames requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveExtract { exitName count zoneNames requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveBuildItem { item { id name normalizedName shortName wikiLink } containsAll { id name normalizedName shortName wikiLink } containsCategory { name normalizedName } }
            ... on TaskObjectiveHideoutStation { hideoutStation { id name normalizedName } stationLevel }
            ... on TaskObjectivePlayerLevel { playerLevel }
            ... on TaskObjectiveSkill { skillLevel { skill { id name } level } }
            ... on TaskObjectiveTraderLevel { trader { id name } level }
            ... on TaskObjectiveTaskStatus { task { id name normalizedName } status }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    } catch (richErr) {
      console.warn('Rich task query failed, trying minimal task query', richErr);
      data = await gql(`query LocalTrackerTasksMinimal($lang: LanguageCode) {
        tasks(lang: $lang) {
          id name normalizedName minPlayerLevel wikiLink
          trader { name normalizedName }
          map { name normalizedName }
          objectives {
            id type description maps { name normalizedName }
            ... on TaskObjectiveItem { items { name shortName } count foundInRaid }
            ... on TaskObjectiveShoot { targetNames count }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    }
    tasks = (data.tasks || []).map(t => compactTaskForStorage({ ...t, source: 'tarkov.dev API' })).filter(Boolean);
    notes.push(`missions ${tasks.length}`);
  } catch (err) {
    console.warn('Task sync failed', err);
    notes.push(`missions failed: ${err.message}`);
  }

  state.apiCache = {
    maps: maps.length ? maps : FALLBACK_MAPS,
    keys: keys.length ? keys : FALLBACK_KEYS,
    tasks: tasks.length ? tasks : FALLBACK_TASKS,
    hideout: hideout.length ? hideout : FALLBACK_HIDEOUT_STATIONS,
    syncedAt: new Date().toISOString(),
    source: `tarkov.dev GraphQL API / compact sync (${notes.join(' • ')})`,
    storagePatch: STORAGE_PATCH_VERSION
  };
  ensureV10State?.();
  state.apiCache.keys = (state.apiCache.keys || []).map(k => compactKeyForStorage(mergeKeyIntel(k))).filter(Boolean);
  try {
    safePersistState(true);
    setSyncStatusHtml(`<p><strong>Sync finished and saved.</strong><br>${notes.map(escapeHtml).join('<br>')}<br><span class="meta">Saved using ${STORAGE_PATCH_VERSION}. Old v2-v8 browser caches were cleared to free space.</span></p>`);
    toast(`Sync finished: ${notes.join(' • ')}`);
  } catch (err) {
    console.error('Compact save failed', err);
    setSyncStatusHtml(`<p class="danger-text"><strong>Sync downloaded, but browser storage is still full.</strong><br>${escapeHtml(err.message)}<br>Try Data / Clear synced cache, or clear site data for localhost, then sync again.</p>`);
  } finally {
    setSyncButtonsDisabled(false);
    render();
  }
};

// Key wiki enrichment saves also need quota-safe persistence.
const oldEnrichOneKeyFromWikiV12 = window.enrichOneKeyFromWiki;
window.enrichOneKeyFromWiki = async function(name) {
  await oldEnrichOneKeyFromWikiV12(name);
  try { safePersistState(true); } catch (err) { console.warn('Key intel compact save failed', err); }
};
const oldClearWikiKeyIntelV12 = window.clearWikiKeyIntel;
window.clearWikiKeyIntel = function() {
  oldClearWikiKeyIntelV12();
  try { safePersistState(true); } catch (err) { console.warn('Key intel compact clear save failed', err); }
};

// Rewire sync buttons after replacing syncTarkovData. Otherwise old onclick handlers keep
// pointing at the earlier oversized sync function.
try {
  if ($('syncBtn')) $('syncBtn').onclick = syncTarkovData;
  if ($('syncBtn2')) $('syncBtn2').onclick = syncTarkovData;
  safePersistState(true); // migrate current save into compact format immediately
  render();
  console.info(`${STORAGE_PATCH_VERSION} loaded: compact localStorage save active.`);
} catch (err) {
  console.warn('v12 quota-safe init warning', err);
}

/* === v13 IndexedDB reference-cache patch ==================================
   localStorage is small on many browsers, so v13 keeps only personal progress
   there and stores synced Tarkov reference data in IndexedDB. */
const STORAGE_PATCH_VERSION_V13 = 'v13-indexeddb-cache';
const IDB_DB_NAME_V13 = 'tarkov-local-tracker-reference-cache';
const IDB_STORE_V13 = 'kv';
const IDB_API_CACHE_KEY_V13 = 'apiCache';

function idbOpenV13() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(IDB_DB_NAME_V13, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_V13)) db.createObjectStore(IDB_STORE_V13, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB.'));
  });
}

async function idbTxV13(mode, fn) {
  const db = await idbOpenV13();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_V13, mode);
    const store = tx.objectStore(IDB_STORE_V13);
    let req;
    try { req = fn(store); } catch (err) { db.close(); reject(err); return; }
    if (req) {
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed.'));
      req.onsuccess = () => resolve(req.result);
    }
    tx.oncomplete = () => { db.close(); if (!req) resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error('IndexedDB transaction failed.')); };
  });
}

function idbGetV13(key) { return idbTxV13('readonly', store => store.get(key)); }
function idbSetV13(key, value) { return idbTxV13('readwrite', store => store.put({ key, value, updatedAt: new Date().toISOString() })); }
function idbDeleteV13(key) { return idbTxV13('readwrite', store => store.delete(key)); }

function compactApiCacheForIndexedDBV13(cache) {
  return {
    maps: (cache?.maps || []).map(compactMapForStorage).filter(Boolean),
    keys: (cache?.keys || []).map(k => compactKeyForStorage(mergeKeyIntel ? mergeKeyIntel(k) : k)).filter(Boolean),
    tasks: (cache?.tasks || []).map(compactTaskForStorage).filter(Boolean),
    hideout: (cache?.hideout || []).map(compactHideoutForStorage).filter(Boolean),
    syncedAt: cache?.syncedAt || new Date().toISOString(),
    source: cache?.source || 'tarkov.dev GraphQL API',
    storagePatch: STORAGE_PATCH_VERSION_V13,
    storedIn: 'IndexedDB'
  };
}

function userProgressOnlyForLocalStorageV13() {
  ensureStateShape();
  const tinyApiCache = {
    maps: [], keys: [], tasks: [], hideout: [],
    syncedAt: state.apiCache?.syncedAt || null,
    source: state.apiCache?.source || 'Reference data stored in IndexedDB',
    storagePatch: STORAGE_PATCH_VERSION_V13,
    storedIn: 'IndexedDB'
  };
  return {
    ...state,
    mapImages: {},
    // Keep personal key wiki notes small; reference key data lives in IndexedDB.
    keyIntel: compactKeyIntelForStorage(state.keyIntel),
    apiCache: tinyApiCache,
    updatedAt: new Date().toISOString()
  };
}

function saveUserProgressOnlyV13(noRender = false) {
  ensureStateShape();
  try { (LEGACY_STORAGE_KEYS || []).forEach(k => localStorage.removeItem(k)); } catch {}
  const tiny = userProgressOnlyForLocalStorageV13();
  const json = JSON.stringify(tiny);
  console.info(`Saving tracker personal progress ${STORAGE_PATCH_VERSION_V13}, ${(json.length / 1024 / 1024).toFixed(2)} MB`);
  localStorage.setItem(STORAGE_KEY, json);
  if (!noRender) render();
  return true;
}

async function persistReferenceCacheV13() {
  const compact = compactApiCacheForIndexedDBV13(state.apiCache || {});
  const approxMb = (JSON.stringify(compact).length / 1024 / 1024).toFixed(2);
  console.info(`Saving Tarkov reference data ${STORAGE_PATCH_VERSION_V13} to IndexedDB, ${approxMb} MB`);
  await idbSetV13(IDB_API_CACHE_KEY_V13, compact);
  state.apiCache = { ...state.apiCache, ...compact };
  return compact;
}

async function loadReferenceCacheV13() {
  try {
    const row = await idbGetV13(IDB_API_CACHE_KEY_V13);
    const cache = row?.value;
    if (cache && ((cache.tasks || []).length || (cache.keys || []).length || (cache.maps || []).length || (cache.hideout || []).length)) {
      state.apiCache = { ...state.apiCache, ...cache };
      console.info(`${STORAGE_PATCH_VERSION_V13} loaded reference cache from IndexedDB: maps=${cache.maps?.length || 0}, keys=${cache.keys?.length || 0}, missions=${cache.tasks?.length || 0}, hideout=${cache.hideout?.length || 0}`);
      render();
      const status = $('syncStatus');
      if (status && state.apiCache?.syncedAt) {
        status.innerHTML = `<p><strong>Reference cache loaded.</strong><br>Maps: ${state.apiCache.maps?.length || 0} • Keys: ${state.apiCache.keys?.length || 0} • Missions: ${state.apiCache.tasks?.length || 0} • Hideout: ${state.apiCache.hideout?.length || 0}<br><span class="meta">Stored in IndexedDB, personal progress in localStorage.</span></p>`;
      }
      return true;
    }
  } catch (err) {
    console.warn('IndexedDB reference cache load failed', err);
  }
  return false;
}

// localStorage is now only for personal progress; big synced reference data is in IndexedDB.
saveState = function() { saveUserProgressOnlyV13(false); };

clearApiCache = async function() {
  state.apiCache = { maps: FALLBACK_MAPS, keys: FALLBACK_KEYS, tasks: FALLBACK_TASKS, hideout: FALLBACK_HIDEOUT_STATIONS, syncedAt: null, source: 'offline fallback', storagePatch: STORAGE_PATCH_VERSION_V13 };
  try { await idbDeleteV13(IDB_API_CACHE_KEY_V13); } catch (err) { console.warn('IndexedDB clear warning', err); }
  saveUserProgressOnlyV13(true);
  render();
  toast('Synced data cache cleared.');
  setSyncStatusHtml?.('<p><strong>Synced reference cache cleared.</strong> Offline fallback data is active.</p>');
};

syncTarkovData = async function() {
  ensureStateShape();
  setSyncStatusHtml('<p><strong>Syncing...</strong> Pulling maps, keys, missions and hideout data separately. v13 stores the large reference cache in IndexedDB so localStorage does not fill up.</p>');
  setSyncButtonsDisabled(true);
  const notes = [];
  let maps = state.apiCache.maps?.length ? state.apiCache.maps : FALLBACK_MAPS;
  let keys = state.apiCache.keys?.length ? state.apiCache.keys : FALLBACK_KEYS;
  let tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : FALLBACK_TASKS;
  let hideout = state.apiCache.hideout?.length ? state.apiCache.hideout : FALLBACK_HIDEOUT_STATIONS;

  try {
    const data = await gql(`query LocalTrackerMaps($lang: LanguageCode) {
      maps(lang: $lang) {
        id name normalizedName wiki description enemies raidDuration players minPlayerLevel maxPlayerLevel
        extracts { id name faction switches { id name switchType } }
        switches { id name switchType }
        bosses { boss { id name normalizedName } spawnChance spawnTrigger spawnLocations { name chance } }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    maps = (data.maps || []).map(compactMapForStorage).filter(Boolean);
    notes.push(`maps ${maps.length}`);
  } catch (err) {
    console.warn('Map sync failed', err);
    notes.push(`maps failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerKeys($lang: LanguageCode) {
      keys: items(type: keys, lang: $lang) {
        id name normalizedName shortName description wikiLink types iconLink
        properties { ... on ItemPropertiesKey { uses } }
        usedInTasks { id name normalizedName }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    keys = (data.keys || []).map(k => compactKeyForStorage(mergeKeyIntel({
      id: k.id,
      name: k.name,
      normalizedName: k.normalizedName,
      shortName: k.shortName,
      wikiLink: k.wikiLink,
      uses: k.properties?.uses || null,
      usedInTasks: (k.usedInTasks || []).map(t => t.name),
      maps: [],
      location: (k.usedInTasks || []).length ? `Used in missions: ${(k.usedInTasks || []).slice(0, 5).map(t => t.name).join(', ')}` : 'Key synced from tarkov.dev. Use wiki lock lookup for exact Lock Location.',
      source: 'tarkov.dev API'
    }))).filter(Boolean);
    notes.push(`keys ${keys.length}`);
  } catch (err) {
    console.warn('Key sync failed', err);
    notes.push(`keys failed: ${err.message}`);
  }

  try {
    const data = await gql(`query LocalTrackerHideout($lang: LanguageCode) {
      hideoutStations(lang: $lang) {
        id name normalizedName
        levels { id level constructionTime description
          itemRequirements { id count quantity item { id name normalizedName shortName wikiLink } }
          stationLevelRequirements { id level station { id name normalizedName } }
          skillRequirements { id name level skill { id name } }
          traderRequirements { id value requirementType compareMethod trader { id name } }
        }
      }
    }`, { lang: 'en' }, { allowPartial: true });
    hideout = (data.hideoutStations || []).map(compactHideoutForStorage).filter(Boolean);
    notes.push(`hideout ${hideout.length}`);
  } catch (err) {
    console.warn('Hideout sync failed', err);
    notes.push(`hideout failed: ${err.message}`);
  }

  try {
    let data;
    try {
      data = await gql(`query LocalTrackerTasks($lang: LanguageCode) {
        tasks(lang: $lang) {
          id tarkovDataId name normalizedName minPlayerLevel wikiLink kappaRequired lightkeeperRequired experience
          trader { id name normalizedName }
          map { id name normalizedName }
          taskRequirements { task { id name normalizedName } status }
          objectives {
            id type description optional maps { id name normalizedName }
            ... on TaskObjectiveBasic { requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveItem { items { id name normalizedName shortName wikiLink } count foundInRaid dogTagLevel maxDurability minDurability requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveQuestItem { questItem { id name normalizedName shortName } count possibleLocations { map { id name normalizedName } } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveShoot { targetNames count zoneNames bodyParts requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveMark { markerItem { id name normalizedName shortName wikiLink } requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveUseItem { useAny { id name normalizedName shortName wikiLink } count zoneNames requiredKeys { id name shortName wikiLink } zones { map { id name normalizedName } } }
            ... on TaskObjectiveExtract { exitName count zoneNames requiredKeys { id name shortName wikiLink } }
            ... on TaskObjectiveBuildItem { item { id name normalizedName shortName wikiLink } containsAll { id name normalizedName shortName wikiLink } containsCategory { name normalizedName } }
            ... on TaskObjectiveHideoutStation { hideoutStation { id name normalizedName } stationLevel }
            ... on TaskObjectivePlayerLevel { playerLevel }
            ... on TaskObjectiveSkill { skillLevel { skill { id name } level } }
            ... on TaskObjectiveTraderLevel { trader { id name } level }
            ... on TaskObjectiveTaskStatus { task { id name normalizedName } status }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    } catch (richErr) {
      console.warn('Rich task query failed, trying minimal task query', richErr);
      data = await gql(`query LocalTrackerTasksMinimal($lang: LanguageCode) {
        tasks(lang: $lang) {
          id name normalizedName minPlayerLevel wikiLink
          trader { name normalizedName }
          map { name normalizedName }
          objectives {
            id type description maps { name normalizedName }
            ... on TaskObjectiveItem { items { name shortName } count foundInRaid }
            ... on TaskObjectiveShoot { targetNames count }
          }
        }
      }`, { lang: 'en' }, { allowPartial: true });
    }
    tasks = (data.tasks || []).map(t => compactTaskForStorage({ ...t, source: 'tarkov.dev API' })).filter(Boolean);
    notes.push(`missions ${tasks.length}`);
  } catch (err) {
    console.warn('Task sync failed', err);
    notes.push(`missions failed: ${err.message}`);
  }

  state.apiCache = {
    maps: maps.length ? maps : FALLBACK_MAPS,
    keys: keys.length ? keys : FALLBACK_KEYS,
    tasks: tasks.length ? tasks : FALLBACK_TASKS,
    hideout: hideout.length ? hideout : FALLBACK_HIDEOUT_STATIONS,
    syncedAt: new Date().toISOString(),
    source: `tarkov.dev GraphQL API / IndexedDB sync (${notes.join(' • ')})`,
    storagePatch: STORAGE_PATCH_VERSION_V13,
    storedIn: 'IndexedDB'
  };
  ensureV10State?.();
  state.apiCache.keys = (state.apiCache.keys || []).map(k => compactKeyForStorage(mergeKeyIntel(k))).filter(Boolean);

  try {
    await persistReferenceCacheV13();
    saveUserProgressOnlyV13(true);
    setSyncStatusHtml(`<p><strong>Sync finished and saved.</strong><br>${notes.map(escapeHtml).join('<br>')}<br><span class="meta">Reference data saved in IndexedDB. Personal progress saved in localStorage.</span></p>`);
    toast(`Sync finished: ${notes.join(' • ')}`);
  } catch (err) {
    console.error('IndexedDB save failed', err);
    setSyncStatusHtml(`<p class="danger-text"><strong>Sync downloaded, but could not save the reference cache.</strong><br>${escapeHtml(err.message)}<br>Try clearing site data for localhost, then sync again.</p>`);
  } finally {
    setSyncButtonsDisabled(false);
    render();
  }
};

// Rewire buttons and boot the IndexedDB cache loader.
try {
  if ($('syncBtn')) $('syncBtn').onclick = syncTarkovData;
  if ($('syncBtn2')) $('syncBtn2').onclick = syncTarkovData;
  if ($('clearApiCacheBtn')) $('clearApiCacheBtn').onclick = clearApiCache;
  saveUserProgressOnlyV13(true);
  loadReferenceCacheV13().finally(() => render());
  console.info(`${STORAGE_PATCH_VERSION_V13} loaded: localStorage = personal progress, IndexedDB = synced Tarkov reference data.`);
} catch (err) {
  console.warn('v13 IndexedDB patch init warning', err);
}

/* ===== v15 crash-safe planner patch =========================================
   This patch intentionally does not change index.html or styles.css. It keeps
   the user-supplied UI and only adds lightweight runtime logic.
============================================================================ */
(function(){
  const V15_BUILD = 'v15-safe-item-usage-no-ui-change';
  const v15Cache = { key: '', index: null, names: [] };

  function v15Norm(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function v15Key(value) { return v15Norm(value).replace(/\s+/g, ''); }
  function v15Esc(value) { return (typeof escapeHtml === 'function') ? escapeHtml(value) : String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
  function v15Arr(value) { return Array.isArray(value) ? value : []; }
  function v15Num(value, fallback = 1) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
  function v15SafeToast(msg) { try { if (typeof toast === 'function') toast(msg); else console.info(msg); } catch { console.info(msg); } }

  function v15GetTasks() {
    try { return state?.apiCache?.tasks?.length ? state.apiCache.tasks : (FALLBACK_TASKS || []); }
    catch { return []; }
  }
  function v15GetHideout() {
    try { return typeof getHideoutStations === 'function' ? getHideoutStations() : (state?.apiCache?.hideout?.length ? state.apiCache.hideout : (FALLBACK_HIDEOUT_STATIONS || [])); }
    catch { return []; }
  }
  function v15HideoutId(station) {
    try { return typeof hideoutStationId === 'function' ? hideoutStationId(station) : v15Key(station?.normalizedName || station?.name || station?.id); }
    catch { return v15Key(station?.normalizedName || station?.name || station?.id); }
  }
  function v15HideoutLevels(station) {
    try { return typeof hideoutLevels === 'function' ? hideoutLevels(station) : v15Arr(station?.levels).slice().sort((a,b) => Number(a.level || 0) - Number(b.level || 0)); }
    catch { return []; }
  }
  function v15HideoutReqItems(level) {
    try { return typeof hideoutReqItems === 'function' ? hideoutReqItems(level) : v15Arr(level?.itemRequirements).map(r => ({ name: r.item?.name || r.name || r.itemName || 'Unknown item', shortName: r.item?.shortName, count: v15Num(r.count || r.quantity, 1) })); }
    catch { return []; }
  }
  function v15ObjectiveItems(objective) {
    try { return typeof objectiveItems === 'function' ? objectiveItems(objective) : []; }
    catch { return []; }
  }
  function v15TaskDone(task) {
    const status = state?.missionProgress?.[task?.id];
    return status === 'done' || status === 'complete' || status === true;
  }
  function v15ObjectiveDone(task, objective, idx) {
    const id = objective?.id || String(idx);
    const direct = `${task?.id}::${id}`;
    try {
      return Boolean(state?.taskObjectives?.[direct] || (typeof objectiveDone === 'function' && objectiveDone(task?.id, id)));
    } catch { return Boolean(state?.taskObjectives?.[direct]); }
  }
  function v15HaveForItem(itemName) {
    const wanted = v15Key(itemName);
    return v15Arr(state?.items).reduce((sum, item) => {
      const names = [item?.name, item?.shortName].filter(Boolean).map(v15Key);
      return names.includes(wanted) ? sum + Number(item?.found || 0) : sum;
    }, 0);
  }
  function v15NeedCardsForItem(itemName) {
    const wanted = v15Key(itemName);
    return v15Arr(state?.items).filter(item => [item?.name, item?.shortName].filter(Boolean).map(v15Key).includes(wanted));
  }

  function v15RequirementCacheKey() {
    const hideLevels = state?.hideoutProgress || {};
    const missionProgress = state?.missionProgress || {};
    const taskObjectives = state?.taskObjectives || {};
    const cache = state?.apiCache || {};
    return JSON.stringify({
      syncedAt: cache.syncedAt || '',
      source: cache.source || '',
      hCount: v15Arr(cache.hideout).length,
      tCount: v15Arr(cache.tasks).length,
      hideLevels,
      missionProgress,
      taskObjectives
    });
  }
  function v15AddUse(index, name, qty, use) {
    if (!name) return;
    const key = v15Key(name);
    if (!key) return;
    let entry = index.get(key);
    if (!entry) {
      entry = { key, name: String(name), hideout: 0, missions: 0, uses: [] };
      index.set(key, entry);
    }
    const count = v15Num(qty, 1);
    if (use.type === 'hideout') entry.hideout += count;
    if (use.type === 'mission') entry.missions += count;
    entry.uses.push({ ...use, qty: count, itemName: String(name) });
  }
  function v15BuildRequirementIndex() {
    const key = v15RequirementCacheKey();
    if (v15Cache.index && v15Cache.key === key) return v15Cache;

    const index = new Map();

    v15GetHideout().forEach(station => {
      const stationId = v15HideoutId(station);
      const current = Number(state?.hideoutProgress?.[stationId] || 0);
      v15HideoutLevels(station).forEach(level => {
        const lvl = Number(level?.level || 0);
        if (!lvl || lvl <= current) return;
        v15HideoutReqItems(level).forEach(req => {
          v15AddUse(index, req.name || req.shortName, req.count, {
            type: 'hideout',
            station: station?.name || stationId || 'Hideout station',
            level: lvl,
            note: `${station?.name || 'Hideout'} level ${lvl}`
          });
        });
      });
    });

    v15GetTasks().forEach(task => {
      if (!task || v15TaskDone(task)) return;
      v15Arr(task.objectives).forEach((objective, idx) => {
        if (v15ObjectiveDone(task, objective, idx)) return;
        const items = v15ObjectiveItems(objective);
        items.forEach(ref => {
          const count = v15Num(ref?.count || objective?.count, 1);
          v15AddUse(index, ref?.name || ref?.shortName, count, {
            type: 'mission',
            mission: task?.name || 'Mission/task',
            trader: task?.trader?.name || '',
            fir: Boolean(ref?.foundInRaid || objective?.foundInRaid),
            note: objective?.description || objective?.type || ''
          });
        });
      });
    });

    const names = [...index.values()].map(e => e.name).sort((a,b) => a.localeCompare(b));
    v15Cache.key = key;
    v15Cache.index = index;
    v15Cache.names = names;
    return v15Cache;
  }
  function v15FindRequirement(query) {
    const qKey = v15Key(query);
    const qLoose = v15Norm(query);
    if (!qKey) return null;
    const { index } = v15BuildRequirementIndex();
    if (index.has(qKey)) return index.get(qKey);
    for (const entry of index.values()) {
      const k = entry.key;
      const loose = v15Norm(entry.name);
      if (k.includes(qKey) || qKey.includes(k) || loose.includes(qLoose)) return entry;
    }
    return null;
  }
  function v15SearchUseText(itemName) {
    const entry = v15FindRequirement(itemName);
    if (!entry) return '';
    return entry.uses.map(u => `${u.station || ''} ${u.mission || ''} ${u.trader || ''} ${u.note || ''}`).join(' ');
  }
  function v15RequirementSummary(itemName) {
    const entry = v15FindRequirement(itemName) || { name: itemName, hideout: 0, missions: 0, uses: [] };
    const total = Number(entry.hideout || 0) + Number(entry.missions || 0);
    const have = v15HaveForItem(entry.name || itemName);
    const cards = v15NeedCardsForItem(entry.name || itemName);
    return { ...entry, total, have, still: Math.max(0, total - have), cards };
  }
  function v15EnsureUsePanel() {
    const needed = document.getElementById('needed');
    const list = document.getElementById('itemList');
    if (!needed || !list) return null;
    let panel = document.getElementById('v15ItemUsePanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'v15ItemUsePanel';
      panel.className = 'panel readable';
      panel.style.display = 'none';
      list.parentNode.insertBefore(panel, list);
    }
    return panel;
  }
  function v15RenderUsePanel(searchText) {
    const panel = v15EnsureUsePanel();
    if (!panel) return;
    const q = String(searchText || '').trim();
    if (!q) { panel.style.display = 'none'; panel.innerHTML = ''; return; }

    const summary = v15RequirementSummary(q);
    const exactName = summary.name || q;
    const uses = v15Arr(summary.uses);
    const useList = uses.slice(0, 18).map(u => {
      const title = u.type === 'hideout'
        ? `Hideout: ${u.station || 'Station'} level ${u.level || ''}`.trim()
        : `Mission: ${u.mission || 'Task'}${u.trader ? ` / ${u.trader}` : ''}`;
      return `<li><strong>${v15Esc(u.qty)}×</strong> ${v15Esc(title)}${u.fir ? ' <span class="badge cyan">FIR</span>' : ''}${u.note ? `<br><small class="meta">${v15Esc(u.note)}</small>` : ''}</li>`;
    }).join('');

    const otherMatches = v15BuildRequirementIndex().names
      .filter(n => v15Norm(n).includes(v15Norm(q)) && v15Key(n) !== v15Key(exactName))
      .slice(0, 7);

    panel.style.display = '';
    panel.innerHTML = `
      <h2>Item use lookup: ${v15Esc(exactName)}</h2>
      <p>Progress-aware count. Hideout levels you already marked as built are ignored, and missions/objectives marked done are ignored.</p>
      <div class="stats">
        <div class="stat"><strong>${v15Esc(summary.still)}</strong><span>Still need</span></div>
        <div class="stat"><strong>${v15Esc(summary.total)}</strong><span>Total remaining</span></div>
        <div class="stat"><strong>${v15Esc(summary.hideout || 0)}</strong><span>Hideout left</span></div>
        <div class="stat"><strong>${v15Esc(summary.missions || 0)}</strong><span>Missions left</span></div>
        <div class="stat"><strong>${v15Esc(summary.have)}</strong><span>Tracker says have</span></div>
      </div>
      ${uses.length ? `<h3>Where this is still used</h3><ul>${useList}</ul>${uses.length > 18 ? `<p class="meta">+ ${uses.length - 18} more uses. Narrow your search for more detail.</p>` : ''}` : `<p>No synced hideout/task usage found for <strong>${v15Esc(q)}</strong>. Try the full item name or sync Tarkov data.</p>`}
      ${otherMatches.length ? `<p class="meta">Other matching items: ${otherMatches.map(n => `<button class="small ghost" type="button" onclick="document.getElementById('searchInput').value='${v15Esc(n).replace(/'/g, '&#39;')}'; render();">${v15Esc(n)}</button>`).join(' ')}</p>` : ''}
    `;
  }

  const v15BaseRenderItems = (typeof renderItems === 'function') ? renderItems : null;
  renderItems = function renderItemsV15Safe() {
    const search = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    const filter = document.getElementById('filterSelect')?.value || 'all';
    const list = document.getElementById('itemList');
    const template = document.getElementById('itemTemplate');
    if (!list || !template) return v15BaseRenderItems && v15BaseRenderItems();

    v15RenderUsePanel(search);
    list.innerHTML = '';

    const filtered = v15Arr(state?.items).filter(item => {
      const useText = search ? v15SearchUseText(item?.name) : '';
      const text = `${item?.name || ''} ${item?.source || ''} ${item?.note || ''} ${useText}`.toLowerCase();
      const matchesSearch = !search || text.includes(search);
      const isTracked = v15Arr(state?.tracked).includes(item.id);
      const unfinished = Number(item?.found || 0) < Number(item?.needed || 0);
      const matchesFilter = filter === 'all' ||
        (filter === 'tracked' && isTracked) ||
        (filter === 'unfinished' && unfinished) ||
        item?.source === filter;
      return matchesSearch && matchesFilter;
    });

    if (!filtered.length) {
      list.innerHTML = `<div class="panel"><p>No items found. Add one from Custom Track, import hideout needs, or sync task items.</p></div>`;
      return;
    }

    const maxCards = search ? 120 : 260;
    filtered.slice(0, maxCards).forEach(item => {
      const clone = template.content.cloneNode(true);
      const isTracked = v15Arr(state?.tracked).includes(item.id);
      const percent = item.needed ? (itemProgress(item) / item.needed) * 100 : 0;
      clone.querySelector('.name').textContent = item.name;
      clone.querySelector('.meta').textContent = item.note || 'No note';
      clone.querySelector('.pill').textContent = item.source;
      clone.querySelector('.progress-text').textContent = `${itemProgress(item)} / ${item.needed} collected`;
      clone.querySelector('.bar span').style.width = `${Math.min(100, percent)}%`;
      const trackBtn = clone.querySelector('.trackBtn');
      trackBtn.textContent = isTracked ? 'Untrack' : 'Track';
      trackBtn.onclick = () => toggleTrack(item.id);
      clone.querySelector('.minusBtn').onclick = () => adjustFound(item.id, -1);
      clone.querySelector('.plusBtn').onclick = () => adjustFound(item.id, 1);
      clone.querySelector('.foundBtn').onclick = () => addRaidFound(item.id);
      clone.querySelector('.deleteBtn').onclick = () => deleteItem(item.id);
      list.appendChild(clone);
    });
    if (filtered.length > maxCards) {
      const more = document.createElement('div');
      more.className = 'panel';
      more.innerHTML = `<p>Showing ${maxCards} of ${filtered.length} items. Use search/filter to narrow it down.</p>`;
      list.appendChild(more);
    }
  };

  const v15BaseRenderHideoutCard = (typeof renderHideoutCard === 'function') ? renderHideoutCard : null;
  renderHideoutCard = function renderHideoutCardV15(station) {
    const id = v15HideoutId(station);
    const cur = Number(state?.hideoutProgress?.[id] || 0);
    const max = Math.max(0, ...v15HideoutLevels(station).map(l => Number(l.level || 0)));
    const next = v15HideoutLevels(station).find(l => Number(l.level || 0) > cur) || null;
    const html = v15BaseRenderHideoutCard ? v15BaseRenderHideoutCard(station) : '';
    if (!html || !next) return html;
    // Keep the existing UI markup. Only add have/left text by replacing simple requirement lines.
    try {
      const box = document.createElement('div');
      box.innerHTML = html;
      v15HideoutReqItems(next).forEach(req => {
        const have = v15HaveForItem(req.name || req.shortName);
        const left = Math.max(0, Number(req.count || 0) - have);
        box.querySelectorAll('li').forEach(li => {
          if (li.textContent && li.textContent.includes(req.name)) {
            li.innerHTML = `<strong>${v15Esc(req.count)}</strong> ${v15Esc(req.name)} <small class="meta">have ${v15Esc(have)} • left ${v15Esc(left)}</small>`;
          }
        });
      });
      return box.innerHTML;
    } catch { return html; }
  };

  const v15PageRenderers = {
    dashboard: () => { renderTrackedList(); },
    needed: () => renderItems(),
    raid: () => renderRaidBag(),
    maps: () => renderMaps(),
    keys: () => renderKeys(),
    keylocker: () => renderKeyLocker(),
    hideout: () => renderHideout(),
    tasks: () => renderTasks(),
    story: () => renderStory(),
    data: () => renderSyncStatus(),
    custom: () => {},
    about: () => {}
  };
  render = function renderV15Safe() {
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch (err) { console.warn('ensureStateShape failed', err); }
    const active = (typeof activePageId === 'function' ? activePageId() : (document.querySelector('.page.active')?.id || 'dashboard'));
    try { if (document.getElementById('stats')) renderStats(); } catch (err) { console.warn('renderStats failed', err); }
    const fn = v15PageRenderers[active] || (() => {});
    try { fn(); }
    catch (err) {
      console.error(`Render failed on ${active}`, err);
      const page = document.getElementById(active);
      const target = page?.querySelector('#hideoutList,#taskList,#itemList,#mapDetail,#keysList,#lockerList,#storyList') || page;
      if (target) target.innerHTML = `<div class="panel"><h2>Page render error</h2><p>The ${v15Esc(active)} tab hit an error instead of crashing the browser. Open the console and send the red error line if this keeps happening.</p><p class="meta">${v15Esc(err.message || err)}</p></div>`;
    }
    try { if (typeof applyTips === 'function') applyTips(); } catch {}
  };

  // Make sure existing click handlers now use the crash-safe render function.
  try {
    if (typeof wireEvents === 'function') wireEvents();
    render();
    console.info(`${V15_BUILD} loaded: exact UI files preserved; item-use lookup is lazy and crash-safe.`);
  } catch (err) {
    console.warn('v15 patch init warning', err);
  }
})();


/* ===== v16 all-items lookup + safe task-import patch ========================
   Keeps the user supplied index.html/styles.css. This injects one extra tab at
   runtime and fixes the task import logic so quest-only items like "Half-Empty"
   are not treated as normal stash items. */
(function(){
  const V16_BUILD = 'v17-all-items-paginated-lookup';
  const v16Cache = { key: '', index: null, allItemsKey: '', allItems: [] };

  function v16$(id){ return document.getElementById(id); }
  function v16Arr(v){ return Array.isArray(v) ? v : []; }
  function v16Esc(value){
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function v16Norm(value){
    return String(value || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function v16Key(value){ return v16Norm(value).replace(/\s+/g,''); }
  function v16Num(value, fallback=1){ const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; }
  function v16Toast(msg){ try { if (typeof toast === 'function') toast(msg); else console.info(msg); } catch { console.info(msg); } }

  function v16EnsureStateShape(){
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch {}
    state.apiCache = state.apiCache || {};
    state.apiCache.allItems = v16Arr(state.apiCache.allItems);
    state.items = v16Arr(state.items);
    state.tracked = v16Arr(state.tracked);
    state.raidBag = state.raidBag || {};
    state.appPrefs = state.appPrefs || {};
  }

  function v16CompactItemForStorage(item){
    if (!item) return null;
    const out = {
      id: item.id || undefined,
      name: item.name || undefined,
      normalizedName: item.normalizedName || undefined,
      shortName: item.shortName || undefined,
      iconLink: item.iconLink || undefined,
      wikiLink: item.wikiLink || undefined,
      types: v16Arr(item.types).slice(0, 12),
      category: item.category?.name || item.category || undefined,
      avg24hPrice: item.avg24hPrice || undefined,
      width: item.width || undefined,
      height: item.height || undefined
    };
    Object.keys(out).forEach(k => (out[k] === undefined || out[k] === null || (Array.isArray(out[k]) && !out[k].length)) && delete out[k]);
    return out.name ? out : null;
  }

  // Allow the v13 IndexedDB cache to keep the new all-items cache as well.
  try {
    const v16BaseCompactApiCache = (typeof compactApiCacheForIndexedDBV13 === 'function') ? compactApiCacheForIndexedDBV13 : null;
    if (v16BaseCompactApiCache) {
      compactApiCacheForIndexedDBV13 = function v16CompactApiCacheForIndexedDB(cache){
        const compact = v16BaseCompactApiCache(cache);
        compact.allItems = v16Arr(cache?.allItems).map(v16CompactItemForStorage).filter(Boolean);
        return compact;
      };
    }
  } catch (err) { console.warn('v16 could not patch IndexedDB compactor', err); }

  function v16IsQuestOnlyObjective(o){
    const type = String(o?.type || '').toLowerCase();
    return type.includes('questitem') || (!!o?.questItem && !v16Arr(o?.items).length && !o?.item && !o?.markerItem && !v16Arr(o?.useAny).length && !v16Arr(o?.containsAll).length);
  }

  function v16ObjectiveStashItems(o){
    if (!o || v16IsQuestOnlyObjective(o)) return [];
    const arr = [];
    if (o.item?.name) arr.push({ ...o.item, count: o.count, foundInRaid: o.foundInRaid });
    v16Arr(o.items).forEach(i => i?.name && arr.push({ ...i, count: o.count, foundInRaid: o.foundInRaid }));
    if (o.markerItem?.name) arr.push({ ...o.markerItem, count: o.count || 1, foundInRaid: o.foundInRaid });
    v16Arr(o.useAny).forEach(i => i?.name && arr.push({ ...i, count: o.count || 1, foundInRaid: o.foundInRaid }));
    v16Arr(o.containsAll).forEach(i => i?.name && arr.push({ ...i, count: 1, foundInRaid: o.foundInRaid }));
    const by = new Map();
    arr.forEach(i => {
      const key = v16Key(i.name || i.shortName);
      if (!key) return;
      const old = by.get(key) || { ...i, count: 0, foundInRaid: false };
      old.name = old.name || i.name;
      old.shortName = old.shortName || i.shortName;
      old.count += v16Num(i.count, 1);
      old.foundInRaid = old.foundInRaid || Boolean(i.foundInRaid);
      by.set(key, old);
    });
    return [...by.values()];
  }

  // Replace the old global helper so task pages and v15 lookup stop counting quest-only special items.
  try {
    objectiveItems = function objectiveItemsV16StashOnly(o){ return v16ObjectiveStashItems(o); };
  } catch (err) { console.warn('v16 could not replace objectiveItems', err); }

  function v16TaskRequiredItems(task){
    const by = new Map();
    v16Arr(task?.objectives).forEach(o => {
      v16ObjectiveStashItems(o).forEach(it => {
        const name = it.name || it.shortName;
        const key = v16Key(name);
        if (!key) return;
        const old = by.get(key) || { name, shortName: it.shortName, count: 0, foundInRaid: false };
        old.count += v16Num(it.count || o.count, 1);
        old.foundInRaid = old.foundInRaid || Boolean(it.foundInRaid || o.foundInRaid);
        by.set(key, old);
      });
    });
    return [...by.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
  }

  try {
    taskRequiredItems = function taskRequiredItemsV16(task){ return v16TaskRequiredItems(task); };
  } catch (err) { console.warn('v16 could not replace taskRequiredItems', err); }

  importTaskItems = function importTaskItemsV16(foundInRaidOnly){
    v16EnsureStateShape();
    const tasks = state.apiCache.tasks?.length ? state.apiCache.tasks : (typeof FALLBACK_TASKS !== 'undefined' ? FALLBACK_TASKS : []);
    const add = new Map();
    tasks.forEach(t => {
      if (state.missionProgress?.[t.id] === 'complete' || state.missionProgress?.[t.id] === 'done') return;
      v16TaskRequiredItems(t).forEach(it => {
        if (foundInRaidOnly && !it.foundInRaid) return;
        const key = v16Key(it.name);
        if (!key) return;
        const old = add.get(key) || { name: it.name, count: 0, notes: [], foundInRaid: false };
        old.count += v16Num(it.count, 1);
        old.foundInRaid = old.foundInRaid || Boolean(it.foundInRaid);
        old.notes.push(`${t.name}${it.foundInRaid ? ' FIR' : ''}`);
        add.set(key, old);
      });
    });
    let added = 0;
    for (const v of add.values()) {
      const existing = state.items.find(i => v16Key(i.name) === v16Key(v.name) && i.source === 'quest');
      if (existing) {
        existing.needed = Math.max(Number(existing.needed || 0), v.count);
        existing.note = `Mission requirements: ${v.notes.slice(0, 4).join(', ')}${v.notes.length > 4 ? '...' : ''}`;
        continue;
      }
      const item = { id: crypto.randomUUID(), name: v.name, needed: v.count, found: 0, source: 'quest', note: `Mission requirements: ${v.notes.slice(0, 4).join(', ')}${v.notes.length > 4 ? '...' : ''}` };
      state.items.push(item);
      state.tracked.push(item.id);
      added++;
    }
    saveState();
    v16Toast(`Imported ${added} normal stash mission item card(s). Quest-only special items were skipped.`);
  };

  function v16LooksLikeBadImportedTaskCard(item){
    const note = String(item?.note || '');
    const name = String(item?.name || '');
    const needed = Number(item?.needed || 0);
    if (item?.source !== 'quest') return false;
    if (!/^Imported from tasks:/i.test(note)) return false;
    return needed > 250 || /half[-\s]?empty|quest item|transit case|sealed letter|folder with/i.test(name);
  }

  function v16RemoveItemsByPredicate(predicate){
    const removeIds = new Set(state.items.filter(predicate).map(i => i.id));
    if (!removeIds.size) return 0;
    state.items = state.items.filter(i => !removeIds.has(i.id));
    state.tracked = state.tracked.filter(id => !removeIds.has(id));
    Object.keys(state.raidBag || {}).forEach(id => { if (removeIds.has(id)) delete state.raidBag[id]; });
    return removeIds.size;
  }

  window.v16CleanBadTaskImports = function(){
    v16EnsureStateShape();
    const count = v16RemoveItemsByPredicate(v16LooksLikeBadImportedTaskCard);
    saveState();
    v16Toast(count ? `Removed ${count} broken imported task card(s).` : 'No broken imported task cards found.');
  };

  window.v16RemoveAllImportedTaskCards = function(){
    v16EnsureStateShape();
    if (!confirm('Remove all quest tracker cards that were created by the old "Import all mission items" button? This will not remove custom, hideout, key, daily or weekly tracker cards.')) return;
    const count = v16RemoveItemsByPredicate(item => item?.source === 'quest' && (/^Imported from tasks:/i.test(String(item?.note || '')) || /^Mission requirements:/i.test(String(item?.note || ''))));
    saveState();
    v16Toast(`Removed ${count} imported mission tracker card(s).`);
  };

  function v16AutoCleanBadImportsOnce(){
    v16EnsureStateShape();
    if (state.appPrefs.v16BadTaskImportsCleaned) return;
    const count = v16RemoveItemsByPredicate(v16LooksLikeBadImportedTaskCard);
    state.appPrefs.v16BadTaskImportsCleaned = true;
    if (count) {
      saveState();
      v16Toast(`Auto-cleaned ${count} broken quest-only import(s), including old Half-Empty style entries.`);
    }
  }

  function v16AllItemDataKey(){
    const cache = state.apiCache || {};
    return JSON.stringify({
      all: v16Arr(cache.allItems).length,
      keys: v16Arr(cache.keys).length,
      tasks: v16Arr(cache.tasks).length,
      hideout: v16Arr(cache.hideout).length,
      syncedAt: cache.syncedAt || '',
      items: v16Arr(state.items).length
    });
  }

  function v16AddKnownItem(map, item, extra={}){
    const name = item?.name || item?.shortName;
    if (!name) return;
    const key = v16Key(name);
    if (!key) return;
    const old = map.get(key) || {};
    const types = new Set([...(old.types || []), ...v16Arr(item.types), ...v16Arr(extra.types)]);
    map.set(key, {
      ...old,
      ...extra,
      id: old.id || item.id,
      name: old.name || item.name || name,
      normalizedName: old.normalizedName || item.normalizedName,
      shortName: old.shortName || item.shortName,
      iconLink: old.iconLink || item.iconLink,
      wikiLink: old.wikiLink || item.wikiLink,
      category: old.category || item.category?.name || item.category || extra.category,
      types: [...types].filter(Boolean)
    });
  }

  function v16AllKnownItems(){
    v16EnsureStateShape();
    const key = v16AllItemDataKey();
    if (v16Cache.allItemsKey === key && v16Cache.allItems.length) return v16Cache.allItems;
    const map = new Map();
    v16Arr(state.apiCache.allItems).forEach(i => v16AddKnownItem(map, i, { source: 'all-items-sync' }));
    v16Arr(state.apiCache.keys).forEach(k => v16AddKnownItem(map, k, { category: 'Key', types: ['key'], source: 'keys' }));
    v16Arr(state.apiCache.hideout).forEach(st => v16Arr(st.levels).forEach(l => v16Arr(l.itemRequirements).forEach(r => v16AddKnownItem(map, r.item, { source: 'hideout' }))));
    v16Arr(state.apiCache.tasks).forEach(t => v16Arr(t.objectives).forEach(o => v16ObjectiveStashItems(o).forEach(i => v16AddKnownItem(map, i, { source: 'tasks' }))));
    v16Arr(state.items).forEach(i => v16AddKnownItem(map, i, { source: 'tracked', category: i.source }));
    try { v16Arr(starterItems).forEach(i => v16AddKnownItem(map, i, { source: 'starter' })); } catch {}
    const arr = [...map.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
    v16Cache.allItemsKey = key;
    v16Cache.allItems = arr;
    return arr;
  }

  function v16TaskDone(task){
    const status = state.missionProgress?.[task?.id];
    return status === 'done' || status === 'complete' || status === true;
  }
  function v16ObjectiveDone(task, objective, idx){
    const id = objective?.id || String(idx);
    const direct = `${task?.id}::${id}`;
    try { return Boolean(state.taskObjectives?.[direct] || (typeof objectiveDone === 'function' && objectiveDone(task?.id, id))); }
    catch { return Boolean(state.taskObjectives?.[direct]); }
  }
  function v16HideoutStationId(station){
    try { return typeof hideoutStationId === 'function' ? hideoutStationId(station) : v16Key(station?.normalizedName || station?.name || station?.id); }
    catch { return v16Key(station?.normalizedName || station?.name || station?.id); }
  }
  function v16HideoutLevels(station){
    try { return typeof hideoutLevels === 'function' ? hideoutLevels(station) : v16Arr(station?.levels).slice().sort((a,b) => Number(a.level || 0) - Number(b.level || 0)); }
    catch { return []; }
  }
  function v16HideoutReqItems(level){
    try { return typeof hideoutReqItems === 'function' ? hideoutReqItems(level) : v16Arr(level?.itemRequirements).map(r => ({ name: r.item?.name || r.name, count: r.count || r.quantity || 1 })); }
    catch { return []; }
  }
  function v16HaveForItem(itemName){
    const wanted = v16Key(itemName);
    return state.items.reduce((sum, item) => {
      return [item.name, item.shortName].filter(Boolean).map(v16Key).includes(wanted) ? sum + Number(item.found || 0) : sum;
    }, 0);
  }
  function v16RequirementIndexKey(){
    return JSON.stringify({
      sync: state.apiCache?.syncedAt || '',
      h: state.hideoutProgress || {},
      m: state.missionProgress || {},
      o: state.taskObjectives || {},
      tasks: v16Arr(state.apiCache?.tasks).length,
      hideout: v16Arr(state.apiCache?.hideout).length,
      items: state.items.map(i => [i.name,i.found]).slice(0,500)
    });
  }
  function v16AddUse(index, name, qty, use){
    const key = v16Key(name);
    if (!key) return;
    let entry = index.get(key);
    if (!entry) { entry = { key, name, hideout: 0, missions: 0, uses: [] }; index.set(key, entry); }
    const count = v16Num(qty, 1);
    if (use.type === 'hideout') entry.hideout += count;
    if (use.type === 'mission') entry.missions += count;
    entry.uses.push({ ...use, qty: count });
  }
  function v16RequirementIndex(){
    const key = v16RequirementIndexKey();
    if (v16Cache.index && v16Cache.key === key) return v16Cache.index;
    const index = new Map();
    v16Arr(state.apiCache.hideout).forEach(station => {
      const stationId = v16HideoutStationId(station);
      const cur = Number(state.hideoutProgress?.[stationId] || 0);
      v16HideoutLevels(station).forEach(level => {
        const lvl = Number(level?.level || 0);
        if (!lvl || lvl <= cur) return;
        v16HideoutReqItems(level).forEach(req => v16AddUse(index, req.name || req.shortName, req.count, { type: 'hideout', station: station.name || stationId, level: lvl, note: `${station.name || 'Hideout'} level ${lvl}` }));
      });
    });
    v16Arr(state.apiCache.tasks).forEach(task => {
      if (!task || v16TaskDone(task)) return;
      v16Arr(task.objectives).forEach((o, idx) => {
        if (v16ObjectiveDone(task, o, idx)) return;
        v16ObjectiveStashItems(o).forEach(item => v16AddUse(index, item.name || item.shortName, item.count || o.count, { type: 'mission', mission: task.name || 'Mission', trader: task.trader?.name || '', fir: Boolean(item.foundInRaid || o.foundInRaid), note: o.description || o.type || '' }));
      });
    });
    v16Cache.key = key;
    v16Cache.index = index;
    return index;
  }
  function v16FindUsage(itemName){
    const qKey = v16Key(itemName);
    if (!qKey) return null;
    const index = v16RequirementIndex();
    if (index.has(qKey)) return index.get(qKey);
    for (const entry of index.values()) {
      if (entry.key.includes(qKey) || qKey.includes(entry.key) || v16Norm(entry.name).includes(v16Norm(itemName))) return entry;
    }
    return null;
  }
  function v16UsageSummary(itemName){
    const entry = v16FindUsage(itemName) || { name: itemName, hideout: 0, missions: 0, uses: [] };
    const total = Number(entry.hideout || 0) + Number(entry.missions || 0);
    const have = v16HaveForItem(entry.name || itemName);
    return { ...entry, total, have, still: Math.max(0, total - have) };
  }

  function v16InjectAllItemsUi(){
    if (v16$('allitems')) return;
    const sidebar = document.querySelector('.sidebar');
    const neededTab = document.querySelector('.tab[data-page="needed"]');
    if (sidebar && neededTab) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.page = 'allitems';
      btn.dataset.num = '02A';
      btn.innerHTML = `<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="7" cy="17" r="1"/></svg></span>All Items Lookup`;
      neededTab.insertAdjacentElement('afterend', btn);
    }
    const neededSection = v16$('needed');
    if (neededSection) {
      const section = document.createElement('section');
      section.id = 'allitems';
      section.className = 'page';
      section.innerHTML = `
        <div class="panel hero">
          <div>
            <span class="kicker">// Database</span>
            <h2>All Items Lookup</h2>
            <p>Search the full synced item list, then see whether that item is still needed for hideout upgrades, missions/tasks, or your own tracker.</p>
          </div>
          <div class="search-row">
            <input id="allItemSearch" placeholder="Search any item, e.g. Wires, Toolset, Salewa..." />
            <select id="allItemFilter">
              <option value="all">All items</option>
              <option value="needed">Still needed</option>
              <option value="hideout">Used in hideout</option>
              <option value="mission">Used in missions</option>
              <option value="key">Keys only</option>
            </select>
          </div>
        </div>
        <div class="panel action-panel">
          <button id="v16CleanBadImportsBtn" class="danger">Clean broken Half-Empty imports</button>
          <button id="v16RemoveImportedTaskCardsBtn" class="ghost">Remove all imported mission tracker cards</button>
          <button id="v16SyncAllItemsBtn" class="primary">Sync all item list</button>
          <p class="meta">Needed Items is for your tracker. This tab is the searchable database / item lookup.</p>
        </div>
        <div id="allItemSummary" class="panel stat-strip"></div>
        <div id="allItemsList" class="grid"></div>`;
      neededSection.insertAdjacentElement('afterend', section);
    }
  }

  function v16WireEvents(){
    v16InjectAllItemsUi();
    document.querySelectorAll('.tab').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const page = v16$(btn.dataset.page);
        if (page) page.classList.add('active');
        if (state?.appPrefs && btn.dataset.page === 'allitems') state.appPrefs.v16AllItemsPage = 1;
        render();
      };
    });
    const debouncedAll = (typeof debounce === 'function') ? debounce(() => { state.appPrefs = state.appPrefs || {}; state.appPrefs.v16AllItemsPage = 1; render(); }, 260) : (() => { state.appPrefs = state.appPrefs || {}; state.appPrefs.v16AllItemsPage = 1; render(); });
    ['allItemSearch'].forEach(id => { const el = v16$(id); if (el) el.oninput = debouncedAll; });
    const filter = v16$('allItemFilter'); if (filter) filter.onchange = () => { state.appPrefs = state.appPrefs || {}; state.appPrefs.v16AllItemsPage = 1; render(); };
    const clean = v16$('v16CleanBadImportsBtn'); if (clean) clean.onclick = window.v16CleanBadTaskImports;
    const remove = v16$('v16RemoveImportedTaskCardsBtn'); if (remove) remove.onclick = window.v16RemoveAllImportedTaskCards;
    const syncItems = v16$('v16SyncAllItemsBtn'); if (syncItems) syncItems.onclick = () => v16SyncAllItems(true);
    if (v16$('importFirTasksBtn')) v16$('importFirTasksBtn').onclick = () => importTaskItems(true);
    if (v16$('importAllTasksBtn')) v16$('importAllTasksBtn').onclick = () => importTaskItems(false);
    if (v16$('syncBtn')) v16$('syncBtn').onclick = syncTarkovData;
    if (v16$('syncBtn2')) v16$('syncBtn2').onclick = syncTarkovData;
  }

  function v16RenderAllItems(){
    v16EnsureStateShape();
    v16InjectAllItemsUi();
    const summaryEl = v16$('allItemSummary');
    const list = v16$('allItemsList');
    if (!list) return;

    state.appPrefs = state.appPrefs || {};
    const searchRaw = String(v16$('allItemSearch')?.value || '').trim();
    const search = searchRaw.toLowerCase();
    const filter = v16$('allItemFilter')?.value || 'all';
    const all = v16AllKnownItems();
    const pageSize = 50;

    function simpleHay(item){
      return `${item?.name || ''} ${item?.shortName || ''} ${item?.normalizedName || ''} ${v16Arr(item?.types).join(' ')} ${item?.category || ''}`.toLowerCase();
    }
    function matchesSearch(item){
      if (!search) return true;
      const hay = simpleHay(item);
      return search.split(/\s+/).filter(Boolean).every(part => hay.includes(part));
    }
    function isKeyLike(item){
      const t = `${v16Arr(item?.types).join(' ')} ${item?.category || ''} ${item?.name || ''}`.toLowerCase();
      return t.includes('key') || t.includes('keycard');
    }
    function itemByKeyMap(items){
      const m = new Map();
      items.forEach(i => { const k = v16Key(i?.name || i?.shortName); if (k && !m.has(k)) m.set(k, i); });
      return m;
    }

    let usageIndex = null;
    let results = [];
    let modeNote = '';

    if (!search && (filter === 'all' || filter === 'key')) {
      const keyCount = all.reduce((n, i) => n + (isKeyLike(i) ? 1 : 0), 0);
      if (summaryEl) summaryEl.innerHTML = `
        <span class="badge gold">${all.length} known items</span>
        <span class="badge cyan">${state.apiCache.allItems?.length || 0} synced item records</span>
        <span class="badge green">${keyCount} key/keycard records</span>
        <span class="badge red">Search before rendering list</span>`;
      list.className = 'stack';
      list.innerHTML = `<div class="panel readable">
        <h2>Search the item database</h2>
        <p>To stop the page crashing, the full item database is hidden until you search. Type an item name like <strong>Wires</strong>, <strong>Toolset</strong>, <strong>Salewa</strong>, <strong>GPU</strong>, or choose a usage filter.</p>
        <p class="meta">Results are shown as a table with ${pageSize} items per page. Usage totals are calculated only for the visible results.</p>
      </div>`;
      return;
    }

    if (filter === 'needed' || filter === 'hideout' || filter === 'mission') {
      usageIndex = v16RequirementIndex();
      const byItem = itemByKeyMap(all);
      results = [...usageIndex.values()].map(entry => {
        const found = byItem.get(entry.key) || byItem.get(v16Key(entry.name));
        return found ? { ...found, name: found.name || entry.name, __usageEntry: entry } : { name: entry.name, shortName: entry.name, category: 'Requirement', __usageEntry: entry };
      }).filter(item => {
        const usage = v16UsageSummary(item.name);
        if (filter === 'needed' && usage.still <= 0) return false;
        if (filter === 'hideout' && usage.hideout <= 0) return false;
        if (filter === 'mission' && usage.missions <= 0) return false;
        return matchesSearch(item) || v16Arr(usage.uses).some(u => `${u.station || ''} ${u.mission || ''} ${u.trader || ''} ${u.note || ''}`.toLowerCase().includes(search));
      });
      modeNote = 'usage-filtered';
    } else {
      results = all.filter(item => matchesSearch(item) && (filter !== 'key' || isKeyLike(item)));
      modeNote = search ? 'search-filtered' : 'filtered';
    }

    results.sort((a,b) => String(a.name || '').localeCompare(String(b.name || '')));
    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Number(state.appPrefs.v16AllItemsPage || 1);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.appPrefs.v16AllItemsPage = page;
    const start = (page - 1) * pageSize;
    const shown = results.slice(start, start + pageSize);

    if (summaryEl) {
      let usageCountText = 'usage calculated on visible rows';
      if (usageIndex) usageCountText = `${usageIndex.size} items used by current hideout/tasks`;
      summaryEl.innerHTML = `
        <span class="badge gold">${all.length} known items</span>
        <span class="badge cyan">${state.apiCache.allItems?.length || 0} synced item records</span>
        <span class="badge green">${total} result(s)</span>
        <span class="badge red">${usageCountText}</span>`;
    }

    function navHtml(position='top'){
      return `<div class="panel action-panel" data-all-items-nav="${position}">
        <button class="small" onclick="v16AllItemsSetPage(1)" ${page <= 1 ? 'disabled' : ''}>First</button>
        <button class="small" onclick="v16AllItemsSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button>
        <span class="pill">Page ${page} / ${totalPages}</span>
        <span class="pill">Showing ${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} of ${total}</span>
        <button class="small" onclick="v16AllItemsSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button>
        <button class="small" onclick="v16AllItemsSetPage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>Last</button>
      </div>`;
    }

    function rowHtml(item){
      const usage = v16UsageSummary(item.name);
      const types = v16Arr(item.types).slice(0,3).join(', ') || item.category || 'item';
      const uses = v16Arr(usage.uses).slice(0, 3).map(u => {
        const title = u.type === 'hideout' ? `${u.station} L${u.level}` : `${u.mission}${u.trader ? ` / ${u.trader}` : ''}`;
        return `${u.qty}× ${title}${u.fir ? ' FIR' : ''}`;
      }).join('<br>') || 'No remaining hideout/task use found';
      const encoded = encodeURIComponent(item.name || '');
      return `<tr>
        <td><strong>${v16Esc(item.name)}</strong><br><span class="meta">${v16Esc(item.shortName || types)}${item.shortName ? ` • ${v16Esc(types)}` : ''}</span></td>
        <td>${v16Esc(usage.still)}</td>
        <td>${v16Esc(usage.hideout || 0)}</td>
        <td>${v16Esc(usage.missions || 0)}</td>
        <td>${v16Esc(usage.have || 0)}</td>
        <td>${uses}</td>
        <td class="card-actions">
          <button class="small primary" onclick="v16TrackStillNeededEncoded('${encoded}')">Track needed</button>
          <button class="small" onclick="v16TrackOneItemEncoded('${encoded}')">Track 1</button>
          ${item.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${v16Esc(item.wikiLink)}">Wiki</a>` : ''}
        </td>
      </tr>`;
    }

    list.className = 'stack';
    list.innerHTML = total ? `${navHtml('top')}
      <div class="panel" style="overflow:auto;">
        <table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:860px;">
          <thead>
            <tr>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Still need</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Hideout</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Missions</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Have</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Used for</th>
              <th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th>
            </tr>
          </thead>
          <tbody>${shown.map(rowHtml).join('')}</tbody>
        </table>
      </div>
      ${navHtml('bottom')}` : `<div class="panel"><h2>No item results</h2><p>Try a different search. If the list is empty, use Sync Data / Sync all item list first.</p></div>`;
  }

  window.v16AllItemsSetPage = function(page){
    v16EnsureStateShape();
    state.appPrefs.v16AllItemsPage = Math.max(1, Number(page) || 1);
    render();
  };
  window.v16TrackStillNeededEncoded = function(encoded){
    window.v16TrackStillNeeded(decodeURIComponent(encoded || ''));
  };
  window.v16TrackOneItemEncoded = function(encoded){
    window.v16TrackOneItem(decodeURIComponent(encoded || ''));
  };

  window.v16TrackStillNeeded = function(name){
    const decoded = document.createElement('textarea'); decoded.innerHTML = name; const itemName = decoded.value;
    const usage = v16UsageSummary(itemName);
    const qty = Math.max(1, usage.still || usage.total || 1);
    const source = usage.hideout && !usage.missions ? 'hideout' : (usage.missions && !usage.hideout ? 'quest' : 'custom');
    const note = usage.total ? `Lookup total: ${usage.hideout || 0} hideout + ${usage.missions || 0} missions remaining` : 'Added from All Items Lookup';
    if (typeof addTrackerItem === 'function') addTrackerItem(itemName, qty, source, note);
    else state.items.push({ id: crypto.randomUUID(), name: itemName, needed: qty, found: 0, source, note });
    const item = state.items.find(i => v16Key(i.name) === v16Key(itemName) && Number(i.needed || 0) >= qty);
    if (item && !state.tracked.includes(item.id)) state.tracked.push(item.id);
    saveState();
    v16Toast(`Tracking ${qty} × ${itemName}.`);
  };
  window.v16TrackOneItem = function(name){
    const decoded = document.createElement('textarea'); decoded.innerHTML = name; const itemName = decoded.value;
    if (typeof addTrackerItem === 'function') addTrackerItem(itemName, 1, 'custom', 'Added from All Items Lookup');
    else state.items.push({ id: crypto.randomUUID(), name: itemName, needed: 1, found: 0, source: 'custom', note: 'Added from All Items Lookup' });
    const item = state.items.find(i => v16Key(i.name) === v16Key(itemName));
    if (item && !state.tracked.includes(item.id)) state.tracked.push(item.id);
    saveState();
    v16Toast(`Tracking 1 × ${itemName}.`);
  };

  async function v16SyncAllItems(manual=false){
    v16EnsureStateShape();
    const status = v16$('syncStatus') || v16$('allItemSummary');
    if (manual && status) status.innerHTML = '<p><strong>Syncing all item list...</strong></p>';
    let items = [];
    try {
      const data = await gql(`query LocalTrackerAllItems($lang: LanguageCode) {
        items(lang: $lang) { id name normalizedName shortName iconLink wikiLink types avg24hPrice width height }
      }`, { lang: 'en' }, { allowPartial: true });
      items = v16Arr(data.items).map(v16CompactItemForStorage).filter(Boolean);
    } catch (err) {
      console.warn('Full all item query failed, trying minimal item query', err);
      const data = await gql(`query LocalTrackerAllItemsMinimal {
        items { id name normalizedName shortName iconLink wikiLink types }
      }`, undefined, { allowPartial: true });
      items = v16Arr(data.items).map(v16CompactItemForStorage).filter(Boolean);
    }
    if (!items.length) throw new Error('No items returned from item sync.');
    state.apiCache.allItems = items;
    state.apiCache.syncedAt = state.apiCache.syncedAt || new Date().toISOString();
    state.apiCache.source = `${state.apiCache.source || 'tarkov.dev GraphQL API'} • all items ${items.length}`;
    try { if (typeof persistReferenceCacheV13 === 'function') await persistReferenceCacheV13(); } catch (err) { console.warn('Could not save all items to IndexedDB', err); }
    try { if (typeof saveUserProgressOnlyV13 === 'function') saveUserProgressOnlyV13(true); else saveState(); } catch (err) { console.warn('Could not save progress after all item sync', err); }
    v16Cache.allItemsKey = '';
    v16Cache.key = '';
    if (manual && status) status.innerHTML = `<p><strong>All items synced.</strong> ${items.length} item records cached in IndexedDB.</p>`;
    v16Toast(`All item list synced: ${items.length} items.`);
    render();
    return items;
  }
  window.v16SyncAllItems = v16SyncAllItems;

  const v16PreviousSync = (typeof syncTarkovData === 'function') ? syncTarkovData : null;
  syncTarkovData = async function syncTarkovDataV16(){
    if (v16PreviousSync) await v16PreviousSync();
    try { await v16SyncAllItems(false); }
    catch (err) {
      console.warn('All item sync failed', err);
      const status = v16$('syncStatus');
      if (status) status.insertAdjacentHTML('beforeend', `<p class="danger-text"><strong>All item list failed:</strong> ${v16Esc(err.message || err)}</p>`);
    }
    v16WireEvents();
  };

  const v16BaseRender = (typeof render === 'function') ? render : null;
  render = function renderV16(){
    v16EnsureStateShape();
    v16InjectAllItemsUi();
    const active = (typeof activePageId === 'function') ? activePageId() : (document.querySelector('.page.active')?.id || 'dashboard');
    if (active === 'allitems') {
      try { if (typeof renderStats === 'function') renderStats(); } catch {}
      try { v16RenderAllItems(); }
      catch (err) {
        console.error('All Items render failed', err);
        const target = v16$('allItemsList') || v16$('allitems');
        if (target) target.innerHTML = `<div class="panel"><h2>All Items render error</h2><p>${v16Esc(err.message || err)}</p></div>`;
      }
      try { if (typeof applyTips === 'function') applyTips(); } catch {}
      return;
    }
    try { if (v16BaseRender) v16BaseRender(); }
    catch (err) {
      console.error('v16 base render failed', err);
      const page = document.getElementById(active);
      if (page) page.innerHTML = `<div class="panel"><h2>Page render error</h2><p>${v16Esc(err.message || err)}</p></div>`;
    }
  };

  try {
    v16EnsureStateShape();
    v16InjectAllItemsUi();
    v16WireEvents();
    v16AutoCleanBadImportsOnce();
    render();
    console.info(`${V16_BUILD} loaded: all-items tab added; quest-only task imports filtered.`);
  } catch (err) {
    console.warn('v16 init warning', err);
  }
})();

/* =========================================================
   v18 patch — Needed Items = manual tracking only
   - Stops bulk task imports from auto-filling Needed Items
   - Filters bogus mission requirement names like task names
   - Cleans old imported task cards once
   - Keeps the uploaded index/styles unchanged
   ========================================================= */
(function(){
  'use strict';
  const V18_BUILD = 'v18-manual-needed-items';
  const $v18 = id => document.getElementById(id);
  const arr18 = v => Array.isArray(v) ? v : [];
  const esc18 = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm18 = s => String(s || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
  const key18 = s => norm18(s).replace(/\s+/g,'');
  const num18 = (v,d=1) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const toast18 = msg => { try { if (typeof toast === 'function') toast(msg); else console.log(msg); } catch { console.log(msg); } };
  const save18 = () => { try { if (typeof saveState === 'function') saveState(); } catch (err) { console.warn('v18 save failed', err); } };
  let reqCache18 = { key: '', value: null };

  function ensure18(){
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch {}
    state.items = arr18(state.items);
    state.tracked = arr18(state.tracked);
    state.raidBag = state.raidBag || {};
    state.apiCache = state.apiCache || {};
    state.appPrefs = state.appPrefs || {};
  }

  function isTaskName(name){
    const k = key18(name);
    if (!k) return false;
    return arr18(state?.apiCache?.tasks).some(t => key18(t?.name) === k);
  }

  function itemLooksReal(item){
    const name = String(item?.name || item?.shortName || '').trim();
    if (!name || name.length < 2 || name.length > 90) return false;
    const k = key18(name);
    if (!k) return false;
    if (isTaskName(name)) return false;

    const badName = /(first\s*in\s*line|half[-\s]?empty|quest\s*item|transit\s*case|sealed\s*letter|letter\s*from|folder\s*with|secure\s*folder|documents?\s*case\s*\(|unknown\s*objective|subtask|objective)/i;
    if (badName.test(name)) return false;

    const objText = `${item?.type || ''} ${arr18(item?.types).join(' ')} ${item?.category || ''}`.toLowerCase();
    if (objText.includes('questitem') || objText.includes('quest item')) return false;

    // API item refs normally include an id/icon/wiki/shortName. If it is just a long objective sentence, reject it.
    const hasItemSignals = !!(item?.id || item?.iconLink || item?.wikiLink || item?.shortName || arr18(item?.types).length);
    const looksLikeSentence = /\b(extract|survive|locate|visit|find\s+the|go\s+to|stash\s+the|mark\s+the|hand\s+over\s+the|eliminate|kill)\b/i.test(name);
    if (!hasItemSignals && looksLikeSentence) return false;
    return true;
  }

  function objectiveIsItemHandIn(o){
    const type = String(o?.type || '').toLowerCase();
    if (type.includes('questitem')) return false;
    if (type.includes('build') || type.includes('hideout') || type.includes('playerlevel') || type.includes('skill') || type.includes('trader') || type.includes('shoot') || type.includes('extract') || type.includes('visit') || type.includes('mark')) return false;
    return true;
  }

  function objectiveItems18(o){
    if (!o) return [];
    const out = [];
    // Only normal stash item objectives. Do not treat questItem/markerItem/useAny/build contents as required hand-in items.
    if (objectiveIsItemHandIn(o)) {
      arr18(o.items).forEach(i => itemLooksReal(i) && out.push({ ...i, count: o.count || i.count || 1, foundInRaid: !!(o.foundInRaid || i.foundInRaid) }));
      if (itemLooksReal(o.item)) out.push({ ...o.item, count: o.count || o.item.count || 1, foundInRaid: !!(o.foundInRaid || o.item.foundInRaid) });
    }
    const by = new Map();
    out.forEach(i => {
      const name = i.name || i.shortName;
      const k = key18(name);
      if (!k) return;
      const old = by.get(k) || { name, shortName: i.shortName, count: 0, foundInRaid: false, id: i.id, wikiLink: i.wikiLink, iconLink: i.iconLink };
      old.count += num18(i.count, 1);
      old.foundInRaid = old.foundInRaid || !!i.foundInRaid;
      by.set(k, old);
    });
    return [...by.values()];
  }

  function taskRequiredItems18(task){
    const by = new Map();
    arr18(task?.objectives).forEach(o => {
      objectiveItems18(o).forEach(it => {
        if (!itemLooksReal(it)) return;
        const k = key18(it.name);
        const old = by.get(k) || { name: it.name, shortName: it.shortName, count: 0, foundInRaid: false };
        old.count += num18(it.count || o.count, 1);
        old.foundInRaid = old.foundInRaid || !!(it.foundInRaid || o.foundInRaid);
        by.set(k, old);
      });
    });
    return [...by.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
  }

  function autoImportedTaskCard(item){
    const note = String(item?.note || '');
    if (item?.source !== 'quest') return false;
    if (/^Imported from tasks:/i.test(note)) return true;
    if (/^Mission requirements:/i.test(note)) return true;
    if (isTaskName(item?.name) && /FIR|Mission|tasks?/i.test(note)) return true;
    return false;
  }

  function removeAutoImports(showToast=false){
    ensure18();
    const removeIds = new Set(state.items.filter(autoImportedTaskCard).map(i => i.id));
    if (!removeIds.size) return 0;
    state.items = state.items.filter(i => !removeIds.has(i.id));
    state.tracked = state.tracked.filter(id => !removeIds.has(id));
    Object.keys(state.raidBag || {}).forEach(id => { if (removeIds.has(id)) delete state.raidBag[id]; });
    save18();
    if (showToast) toast18(`Removed ${removeIds.size} auto-imported mission tracker card(s). Needed Items is manual only now.`);
    return removeIds.size;
  }

  // Make the existing task pages/lookup use the stricter item detection.
  try { objectiveItems = objectiveItems18; } catch (err) { console.warn('v18 could not replace objectiveItems', err); }
  try { taskRequiredItems = taskRequiredItems18; } catch (err) { console.warn('v18 could not replace taskRequiredItems', err); }

  // Stop global task imports filling Needed Items with every mission requirement.
  importTaskItems = function importTaskItemsV18(){
    toast18('Bulk mission import is disabled. Needed Items now stays empty until you press Track on a specific item/key/mission.');
  };

  window.importOneTask = function importOneTaskV18(taskId, firOnly){
    ensure18();
    const task = arr18(state.apiCache?.tasks).find(t => t.id === taskId) || arr18(typeof FALLBACK_TASKS !== 'undefined' ? FALLBACK_TASKS : []).find(t => t.id === taskId);
    if (!task) return toast18('Mission not found in cache. Try Sync Data first.');
    let added = 0;
    taskRequiredItems18(task).forEach(v => {
      if (firOnly && !v.foundInRaid) return;
      if (!itemLooksReal(v)) return;
      const existing = state.items.find(i => key18(i.name) === key18(v.name));
      if (existing) {
        existing.needed = Math.max(num18(existing.needed, 1), num18(v.count, 1));
        if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id);
      } else {
        const item = { id: crypto.randomUUID(), name: v.name, needed: num18(v.count, 1), found: 0, source: 'quest', note: `${task.name}${v.foundInRaid ? ' • FIR' : ''}` };
        state.items.push(item);
        state.tracked.push(item.id);
        added++;
      }
    });
    save18();
    toast18(added ? `Tracked ${added} item(s) for ${task.name}.` : 'No normal stash item requirements found for this mission, or they are already tracked.');
  };

  function requirementIndex18(){
    ensure18();
    const cacheKey = JSON.stringify({
      sync: state.apiCache?.syncedAt || '',
      hideout: state.hideoutProgress || {},
      missions: state.missionProgress || {},
      objectives: state.taskObjectives || {},
      items: arr18(state.items).map(i => [i.name, i.found, i.needed]).slice(0, 1000)
    });
    if (reqCache18.value && reqCache18.key === cacheKey) return reqCache18.value;
    const index = new Map();
    const add = (name, qty, use) => {
      if (!itemLooksReal({ name, shortName: name })) return;
      const k = key18(name);
      if (!k) return;
      const entry = index.get(k) || { key:k, name, hideout:0, missions:0, uses:[] };
      const count = num18(qty, 1);
      if (use.type === 'hideout') entry.hideout += count;
      if (use.type === 'mission') entry.missions += count;
      entry.uses.push({ ...use, qty: count });
      index.set(k, entry);
    };

    arr18(state.apiCache?.hideout).forEach(station => {
      const stationId = station.id || station.normalizedName || station.name;
      const current = Number(state.hideoutProgress?.[stationId] || state.hideoutProgress?.[station.name] || 0);
      const levels = arr18(station.levels);
      levels.forEach(level => {
        const lvl = Number(level?.level || 0);
        if (!lvl || lvl <= current) return;
        arr18(level.itemRequirements).forEach(req => {
          const name = req.item?.name || req.name;
          add(name, req.count || req.quantity || 1, { type:'hideout', station:station.name || stationId, level:lvl, note:`${station.name || 'Hideout'} level ${lvl}` });
        });
      });
    });

    const taskDone = (task) => {
      const s = state.missionProgress?.[task.id];
      return s === 'done' || s === 'complete';
    };
    const objectiveDone18 = (task, obj, idx) => {
      try {
        if (typeof objectiveKey === 'function') return !!state.taskObjectives?.[objectiveKey(task.id, obj.id || String(idx))] || !!state.taskObjectives?.[objectiveKey(task.id, obj.id)];
      } catch {}
      return !!state.taskObjectives?.[`${task.id}::${obj.id || idx}`];
    };
    arr18(state.apiCache?.tasks).forEach(task => {
      if (!task || taskDone(task)) return;
      arr18(task.objectives).forEach((o, idx) => {
        if (objectiveDone18(task, o, idx)) return;
        objectiveItems18(o).forEach(item => add(item.name, item.count || o.count || 1, { type:'mission', mission:task.name || 'Mission', trader:task.trader?.name || '', fir:!!(item.foundInRaid || o.foundInRaid), note:o.description || '' }));
      });
    });
    reqCache18 = { key: cacheKey, value: index };
    return index;
  }

  function usage18(itemName){
    const q = key18(itemName);
    const index = requirementIndex18();
    let entry = index.get(q);
    if (!entry) {
      for (const e of index.values()) {
        if (e.key === q || e.key.includes(q) || q.includes(e.key)) { entry = e; break; }
      }
    }
    entry = entry || { key:q, name:itemName, hideout:0, missions:0, uses:[] };
    const have = arr18(state.items).reduce((sum, i) => key18(i.name) === key18(entry.name) ? sum + Number(i.found || 0) : sum, 0);
    const total = Number(entry.hideout || 0) + Number(entry.missions || 0);
    return { ...entry, total, have, still: Math.max(0, total - have) };
  }

  // Patch the All Items action buttons to use the strict usage counts.
  window.v16TrackStillNeeded = function v18TrackStillNeeded(name){
    ensure18();
    const itemName = String(name || '').trim();
    const usage = usage18(itemName);
    const qty = Math.max(1, usage.still || usage.total || 1);
    const source = usage.hideout && !usage.missions ? 'hideout' : (usage.missions && !usage.hideout ? 'quest' : 'custom');
    const note = usage.total ? `Lookup total: ${usage.hideout || 0} hideout + ${usage.missions || 0} missions remaining` : 'Added from All Items Lookup';
    const existing = state.items.find(i => key18(i.name) === key18(itemName) && String(i.note || '').startsWith('Lookup total'));
    if (existing) {
      existing.needed = Math.max(num18(existing.needed, 1), qty);
      existing.source = source;
      existing.note = note;
      if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id);
    } else {
      const item = { id: crypto.randomUUID(), name: itemName, needed: qty, found: 0, source, note };
      state.items.push(item);
      state.tracked.push(item.id);
    }
    save18();
    toast18(`Tracking ${qty} × ${itemName}.`);
  };


  function allKnownItems18(){
    const map = new Map();
    const add = (item, fallbackSource='') => {
      if (!item) return;
      const name = item.name || item.shortName;
      if (!itemLooksReal({ ...item, name })) return;
      const k = key18(name);
      if (!k) return;
      const old = map.get(k) || {};
      map.set(k, { ...old, ...item, name: old.name || name, shortName: old.shortName || item.shortName, sourceHint: old.sourceHint || fallbackSource });
    };
    arr18(state.apiCache?.allItems).forEach(i => add(i, 'all-items'));
    arr18(state.apiCache?.keys).forEach(k => add({ ...k, types: ['Key'] }, 'keys'));
    arr18(state.apiCache?.hideout).forEach(station => arr18(station.levels).forEach(level => arr18(level.itemRequirements).forEach(req => add(req.item || { name:req.name, shortName:req.shortName }, 'hideout'))));
    arr18(state.apiCache?.tasks).forEach(task => arr18(task.objectives).forEach(o => objectiveItems18(o).forEach(i => add(i, 'tasks'))));
    arr18(state.items).forEach(i => add(i, 'tracked'));
    return [...map.values()].sort((a,b) => String(a.name||'').localeCompare(String(b.name||'')));
  }

  function isKeyLike18(item){
    const t = `${arr18(item?.types).join(' ')} ${item?.category || ''} ${item?.name || ''} ${item?.shortName || ''}`.toLowerCase();
    return t.includes('key') || t.includes('keycard');
  }

  function renderAllItems18(){
    ensure18();
    const summaryEl = $v18('allItemSummary');
    const list = $v18('allItemsList');
    if (!list) return;
    const searchRaw = String($v18('allItemSearch')?.value || '').trim();
    const search = norm18(searchRaw);
    const filter = $v18('allItemFilter')?.value || 'all';
    const all = allKnownItems18();
    const pageSize = 50;
    state.appPrefs = state.appPrefs || {};

    if (!search && (filter === 'all' || filter === 'key')) {
      const keyCount = all.reduce((n,i)=> n + (isKeyLike18(i) ? 1 : 0), 0);
      if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr18(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${keyCount} key/keycard records</span><span class="badge red">Search before rendering list</span>`;
      list.className = 'stack';
      list.innerHTML = `<div class="panel readable"><h2>Search the item database</h2><p>Needed Items will stay empty until you press <strong>Track needed</strong> or <strong>Track 1</strong>. Type an item name like <strong>Wires</strong>, <strong>Toolset</strong>, <strong>Salewa</strong>, or choose a usage filter.</p><p class="meta">Showing results in a 50-item table so the page does not crash.</p></div>`;
      return;
    }

    function hay(item){ return norm18(`${item?.name || ''} ${item?.shortName || ''} ${item?.normalizedName || ''} ${arr18(item?.types).join(' ')} ${item?.category || ''}`); }
    function matches(item){
      if (!search) return true;
      const h = hay(item);
      return search.split(/\s+/).filter(Boolean).every(part => h.includes(part));
    }

    let results = all.filter(item => {
      if (!matches(item)) return false;
      if (filter === 'key' && !isKeyLike18(item)) return false;
      if (filter === 'hideout' && usage18(item.name).hideout <= 0) return false;
      if (filter === 'mission' && usage18(item.name).missions <= 0) return false;
      if (filter === 'needed' && usage18(item.name).still <= 0) return false;
      return true;
    });
    if ((filter === 'needed' || filter === 'hideout' || filter === 'mission') && !search) {
      const idx = requirementIndex18();
      const byKey = new Map(all.map(i => [key18(i.name), i]));
      results = [...idx.values()].map(entry => byKey.get(entry.key) || { name: entry.name, shortName: entry.name, sourceHint:'requirement' }).filter(item => {
        const u = usage18(item.name);
        if (filter === 'needed') return u.still > 0;
        if (filter === 'hideout') return u.hideout > 0;
        if (filter === 'mission') return u.missions > 0;
        return true;
      }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    }

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Number(state.appPrefs.v16AllItemsPage || 1);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.appPrefs.v16AllItemsPage = page;
    const start = (page - 1) * pageSize;
    const shown = results.slice(start, start + pageSize);
    if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr18(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${total} result(s)</span><span class="badge red">Needed Items manual only</span>`;

    const nav = pos => `<div class="panel action-panel" data-all-items-nav="${pos}"><button class="small" onclick="v16AllItemsSetPage(1)" ${page <= 1 ? 'disabled' : ''}>First</button><button class="small" onclick="v16AllItemsSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button><span class="pill">Page ${page} / ${totalPages}</span><span class="pill">Showing ${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} of ${total}</span><button class="small" onclick="v16AllItemsSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button><button class="small" onclick="v16AllItemsSetPage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>Last</button></div>`;
    const rows = shown.map(item => {
      const u = usage18(item.name);
      const uses = arr18(u.uses).slice(0,3).map(use => {
        const title = use.type === 'hideout' ? `${use.station} L${use.level}` : `${use.mission}${use.trader ? ` / ${use.trader}` : ''}`;
        return `${use.qty}× ${esc18(title)}${use.fir ? ' FIR' : ''}`;
      }).join('<br>') || 'No remaining hideout/task use found';
      const encoded = encodeURIComponent(item.name || '');
      const types = arr18(item.types).slice(0,3).join(', ') || item.category || item.sourceHint || 'item';
      return `<tr><td><strong>${esc18(item.name)}</strong><br><span class="meta">${esc18(item.shortName || types)}${item.shortName ? ` • ${esc18(types)}` : ''}</span></td><td>${esc18(u.still)}</td><td>${esc18(u.hideout || 0)}</td><td>${esc18(u.missions || 0)}</td><td>${esc18(u.have || 0)}</td><td>${uses}</td><td class="card-actions"><button class="small primary" onclick="v16TrackStillNeededEncoded('${encoded}')">Track needed</button><button class="small" onclick="v16TrackOneItemEncoded('${encoded}')">Track 1</button>${item.wikiLink ? ` <a class="buttonLink small" target="_blank" rel="noreferrer" href="${esc18(item.wikiLink)}">Wiki</a>` : ''}</td></tr>`;
    }).join('');
    list.className = 'stack';
    list.innerHTML = total ? `${nav('top')}<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:860px;"><thead><tr><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Still need</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Hideout</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Missions</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Have</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Used for</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${nav('bottom')}` : `<div class="panel"><h2>No item results</h2><p>Try a different search. If the list is empty, use Sync Data / Sync all item list first.</p></div>`;
  }

  function wire18(){
    const bulk1 = $v18('importFirTasksBtn');
    const bulk2 = $v18('importAllTasksBtn');
    if (bulk1) { bulk1.textContent = 'Bulk mission import disabled'; bulk1.onclick = () => importTaskItems(); }
    if (bulk2) { bulk2.textContent = 'Use item lookup / mission card Track'; bulk2.onclick = () => importTaskItems(); }
    const clean = $v18('v16RemoveImportedTaskCardsBtn');
    if (clean) clean.onclick = () => removeAutoImports(true);
    const cleanBad = $v18('v16CleanBadImportsBtn');
    if (cleanBad) cleanBad.onclick = () => removeAutoImports(true);
  }

  const baseRender18 = (typeof render === 'function') ? render : null;
  render = function renderV18(){
    ensure18();
    const removed = !state.appPrefs.v18CleanedAutoTaskImports ? removeAutoImports(false) : 0;
    state.appPrefs.v18CleanedAutoTaskImports = true;
    if (removed) save18();
    const active = document.querySelector('.page.active')?.id || 'dashboard';
    if (active === 'allitems') {
      try { if (typeof renderStats === 'function') renderStats(); } catch {}
      try { renderAllItems18(); } catch (err) {
        console.error('v18 all-items render failed', err);
        const list = $v18('allItemsList') || $v18('allitems');
        if (list) list.innerHTML = `<div class="panel"><h2>All Items render error</h2><p>${esc18(err.message || err)}</p></div>`;
      }
      wire18();
      return;
    }
    if (baseRender18) baseRender18();
    wire18();
  };

  try {
    ensure18();
    const removed = removeAutoImports(false);
    state.appPrefs.v18CleanedAutoTaskImports = true;
    if (removed) save18();
    wire18();
    render();
    console.info(`${V18_BUILD} loaded: Needed Items stays manual; bulk mission imports disabled; bad task requirement names filtered.`);
  } catch (err) {
    console.warn('v18 init warning', err);
  }
})();
/* =========================================================
   v19 patch — strict item usage counts
   - Stops broad/choice mission objectives being counted as every item
   - Counts find + handover pairs once per task/item using max count
   - Keeps Needed Items manual-only
   - Keeps user supplied index.html/styles.css unchanged
   ========================================================= */
(function(){
  'use strict';
  const BUILD = 'v19-strict-usage-counts';
  const $ = id => document.getElementById(id);
  const arr = v => Array.isArray(v) ? v : [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm = s => String(s || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  const key = s => norm(s).replace(/\s+/g,'');
  const num = (v,d=1) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const toastSafe = msg => { try { if (typeof toast === 'function') toast(msg); else console.log(msg); } catch { console.log(msg); } };
  const saveSafe = () => { try { if (typeof saveState === 'function') saveState(); } catch (err) { console.warn('v19 save failed', err); } };
  let reqCache = { key:'', value:null };

  function ensure(){
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch {}
    window.state = window.state || {};
    state.items = arr(state.items);
    state.tracked = arr(state.tracked);
    state.apiCache = state.apiCache || {};
    state.hideoutProgress = state.hideoutProgress || {};
    state.missionProgress = state.missionProgress || {};
    state.taskObjectives = state.taskObjectives || {};
    state.appPrefs = state.appPrefs || {};
  }

  function taskNameSet(){
    return new Set(arr(state.apiCache?.tasks).map(t => key(t?.name)).filter(Boolean));
  }

  function isRealItem(item){
    const name = String(item?.name || item?.shortName || '').trim();
    if (!name || name.length < 2 || name.length > 90) return false;
    const k = key(name);
    if (!k) return false;
    if (taskNameSet().has(k)) return false;
    const badName = /(first\s*in\s*line|half[-\s]?empty|quest\s*item|transit\s*case|sealed\s*letter|letter\s*from|folder\s*with|secure\s*folder|documents?\s*case\s*\(|unknown\s*objective|subtask|objective|requirements?:)/i;
    if (badName.test(name)) return false;
    const objText = `${item?.type || ''} ${arr(item?.types).join(' ')} ${item?.category || ''}`.toLowerCase();
    if (objText.includes('questitem') || objText.includes('quest item')) return false;
    const hasItemSignals = !!(item?.id || item?.iconLink || item?.wikiLink || item?.shortName || arr(item?.types).length);
    const looksLikeSentence = /\b(extract|survive|locate|visit|find\s+the|go\s+to|stash\s+the|mark\s+the|hand\s+over\s+the|eliminate|kill)\b/i.test(name);
    if (!hasItemSignals && looksLikeSentence) return false;
    return true;
  }

  function objectiveLooksLikeBroadChoice(objective, items){
    const desc = norm(objective?.description || '');
    const type = String(objective?.type || '').toLowerCase();
    if (objective?.containsCategory || arr(objective?.containsAll).length) return true;
    if (items.length > 6) return true;
    if (/\b(any|any item|one of|from category|category|weapon type|armor class|equipment slot|wear any|with any)\b/.test(desc)) return true;
    if (/weapon|armor|equipment|builditem/.test(type) && items.length > 1) return true;
    return false;
  }

  function objectiveIsNormalItemRequirement(objective){
    if (!objective) return false;
    if (objective.optional) return false;
    const type = String(objective.type || '').toLowerCase();
    if (!type.includes('item')) return false;
    if (/questitem|useitem|mark|builditem|hideout|playerlevel|skill|trader|shoot|extract|visit|taskstatus/.test(type)) return false;
    if (objective.questItem || objective.markerItem || objective.useAny || objective.hideoutStation) return false;
    return true;
  }

  function objectiveItemsStrict(objective){
    if (!objectiveIsNormalItemRequirement(objective)) return [];
    const raw = [];
    arr(objective.items).forEach(i => raw.push(i));
    if (objective.item) raw.push(objective.item);
    const real = raw.filter(isRealItem);
    if (!real.length) return [];
    if (objectiveLooksLikeBroadChoice(objective, real)) return [];

    const by = new Map();
    real.forEach(i => {
      const name = i.name || i.shortName;
      const k = key(name);
      if (!k) return;
      const old = by.get(k) || {
        key:k,
        id:i.id,
        name,
        shortName:i.shortName,
        wikiLink:i.wikiLink,
        iconLink:i.iconLink,
        count:0,
        foundInRaid:false
      };
      old.count = Math.max(num(old.count,0), num(i.count || objective.count, 1));
      old.foundInRaid = old.foundInRaid || !!(i.foundInRaid || objective.foundInRaid || /in raid|found in raid|fir/.test(norm(objective.description || '')));
      by.set(k, old);
    });
    return [...by.values()];
  }

  function getHideoutStationsStrict(){
    try { if (typeof getHideoutStations === 'function') return getHideoutStations(); } catch {}
    return arr(state.apiCache?.hideout);
  }
  function stationIdStrict(station){
    try { if (typeof hideoutStationId === 'function') return hideoutStationId(station); } catch {}
    return station?.id || station?.normalizedName || key(station?.name);
  }
  function stationLevelStrict(station){
    const candidates = [stationIdStrict(station), station?.id, station?.normalizedName, station?.name, key(station?.name)];
    for (const c of candidates) {
      if (c != null && Object.prototype.hasOwnProperty.call(state.hideoutProgress || {}, c)) return Number(state.hideoutProgress[c] || 0);
    }
    return 0;
  }
  function hideoutLevelsStrict(station){
    try { if (typeof hideoutLevels === 'function') return hideoutLevels(station); } catch {}
    return arr(station?.levels).slice().sort((a,b)=>Number(a.level||0)-Number(b.level||0));
  }
  function hideoutReqItemsStrict(level){
    try { if (typeof hideoutReqItems === 'function') return hideoutReqItems(level); } catch {}
    return arr(level?.itemRequirements).map(r => ({
      name: r.item?.name || r.name || r.itemName,
      shortName: r.item?.shortName || r.shortName,
      id: r.item?.id || r.id,
      count: num(r.count || r.quantity, 1)
    })).filter(isRealItem);
  }

  function taskDoneStrict(task){
    const s = state.missionProgress?.[task?.id];
    return s === 'done' || s === 'complete' || s === true;
  }
  function objectiveDoneStrict(task, obj, idx){
    try {
      if (typeof objectiveKey === 'function') {
        if (state.taskObjectives?.[objectiveKey(task.id, obj.id || String(idx))]) return true;
        if (obj.id && state.taskObjectives?.[objectiveKey(task.id, obj.id)]) return true;
      }
    } catch {}
    return !!state.taskObjectives?.[`${task?.id}::${obj?.id || idx}`];
  }

  function addUse(index, name, qty, use){
    if (!name || !isRealItem({ name, shortName:name })) return;
    const k = key(name);
    if (!k) return;
    const entry = index.get(k) || { key:k, name, hideout:0, missions:0, uses:[] };
    const count = num(qty, 1);
    if (use.type === 'hideout') entry.hideout += count;
    if (use.type === 'mission') entry.missions += count;
    entry.uses.push({ ...use, qty: count });
    index.set(k, entry);
  }

  function requirementCacheKey(){
    return JSON.stringify({
      sync: state.apiCache?.syncedAt || '',
      hCount: arr(state.apiCache?.hideout).length,
      tCount: arr(state.apiCache?.tasks).length,
      hideoutProgress: state.hideoutProgress || {},
      missionProgress: state.missionProgress || {},
      objectiveCount: Object.keys(state.taskObjectives || {}).length,
      itemFound: arr(state.items).map(i => [key(i.name), i.found]).slice(0,500)
    });
  }

  function buildRequirementIndex(){
    ensure();
    const cacheKey = requirementCacheKey();
    if (reqCache.value && reqCache.key === cacheKey) return reqCache.value;
    const index = new Map();

    // Hideout: count only levels above the level the user marked as already built.
    getHideoutStationsStrict().forEach(station => {
      const current = stationLevelStrict(station);
      hideoutLevelsStrict(station).forEach(level => {
        const lvl = Number(level?.level || 0);
        if (!lvl || lvl <= current) return;
        hideoutReqItemsStrict(level).forEach(req => {
          addUse(index, req.name || req.shortName, req.count, {
            type:'hideout',
            station: station?.name || stationIdStrict(station) || 'Hideout station',
            level:lvl,
            note:`${station?.name || 'Hideout'} level ${lvl}`
          });
        });
      });
    });

    // Missions: count one requirement per task/item. This prevents find + handover pairs
    // from doubling, and prevents broad choice objectives from counting every possible item.
    arr(state.apiCache?.tasks).forEach(task => {
      if (!task || taskDoneStrict(task)) return;
      const perTaskItem = new Map();
      arr(task.objectives).forEach((objective, idx) => {
        if (objectiveDoneStrict(task, objective, idx)) return;
        objectiveItemsStrict(objective).forEach(item => {
          const k = key(item.name || item.shortName);
          if (!k) return;
          const old = perTaskItem.get(k) || {
            key:k,
            name:item.name || item.shortName,
            count:0,
            foundInRaid:false,
            notes:[]
          };
          old.count = Math.max(num(old.count,0), num(item.count || objective.count,1));
          old.foundInRaid = old.foundInRaid || !!item.foundInRaid;
          const note = String(objective.description || objective.type || '').trim();
          if (note && !old.notes.includes(note)) old.notes.push(note);
          perTaskItem.set(k, old);
        });
      });
      perTaskItem.forEach(item => {
        addUse(index, item.name, item.count, {
          type:'mission',
          mission:task.name || 'Mission/task',
          trader:task.trader?.name || '',
          fir:!!item.foundInRaid,
          note:item.notes.slice(0,2).join(' / ')
        });
      });
    });

    reqCache = { key:cacheKey, value:index };
    window.v19RequirementIndex = index;
    return index;
  }

  function findRequirement(itemName){
    const q = key(itemName);
    const index = buildRequirementIndex();
    let entry = index.get(q);
    if (!entry) {
      // Prefer exact/word-ish item name matches before broad fuzzy matches.
      const qNorm = norm(itemName);
      for (const e of index.values()) {
        const eNorm = norm(e.name);
        if (eNorm === qNorm || eNorm.includes(qNorm) || qNorm.includes(eNorm)) { entry = e; break; }
      }
    }
    return entry || { key:q, name:itemName, hideout:0, missions:0, uses:[] };
  }

  function haveForItem(itemName){
    const q = key(itemName);
    return arr(state.items).reduce((sum, i) => key(i.name) === q ? sum + Number(i.found || 0) : sum, 0);
  }
  function usage(itemName){
    const entry = findRequirement(itemName);
    const total = Number(entry.hideout || 0) + Number(entry.missions || 0);
    const have = haveForItem(entry.name || itemName);
    return { ...entry, total, have, still: Math.max(0, total - have) };
  }
  window.v19ItemUsage = usage;

  function isKeyLike(item){
    const t = `${arr(item?.types).join(' ')} ${item?.category || ''} ${item?.name || ''} ${item?.shortName || ''}`.toLowerCase();
    return t.includes('key') || t.includes('keycard');
  }

  function knownItems(){
    const map = new Map();
    const add = (item, sourceHint='') => {
      if (!isRealItem(item)) return;
      const name = item.name || item.shortName;
      const k = key(name);
      if (!k) return;
      const old = map.get(k) || {};
      map.set(k, { ...old, ...item, name: old.name || name, shortName: old.shortName || item.shortName, sourceHint: old.sourceHint || sourceHint });
    };
    arr(state.apiCache?.allItems).forEach(i => add(i, 'all-items'));
    arr(state.apiCache?.keys).forEach(k => add({ ...k, types:['Key'] }, 'keys'));
    getHideoutStationsStrict().forEach(station => hideoutLevelsStrict(station).forEach(level => hideoutReqItemsStrict(level).forEach(req => add(req, 'hideout'))));
    arr(state.apiCache?.tasks).forEach(task => arr(task.objectives).forEach(o => objectiveItemsStrict(o).forEach(i => add(i, 'tasks'))));
    arr(state.items).forEach(i => add(i, 'tracked'));
    return [...map.values()].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  }

  function renderAllItems(){
    ensure();
    const summaryEl = $('allItemSummary');
    const list = $('allItemsList');
    if (!list) return;
    const searchRaw = String($('allItemSearch')?.value || '').trim();
    const search = norm(searchRaw);
    const filter = $('allItemFilter')?.value || 'all';
    const all = knownItems();
    const pageSize = 50;

    if (!search && (filter === 'all' || filter === 'key')) {
      const keyCount = all.reduce((n,i)=>n + (isKeyLike(i) ? 1 : 0),0);
      if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${keyCount} key/keycard records</span><span class="badge red">Search before rendering list</span><span class="badge cyan">Strict task counts v19</span>`;
      list.className = 'stack';
      list.innerHTML = `<div class="panel readable"><h2>Search the item database</h2><p>Needed Items stays empty until you press <strong>Track needed</strong> or <strong>Track 1</strong>. Mission counts now skip broad choice objectives and count find/hand-over pairs once.</p><p class="meta">Results are paged at 50 rows.</p></div>`;
      return;
    }

    function hay(item){ return norm(`${item?.name || ''} ${item?.shortName || ''} ${item?.normalizedName || ''} ${arr(item?.types).join(' ')} ${item?.category || ''}`); }
    function matches(item){
      if (!search) return true;
      const h = hay(item);
      return search.split(/\s+/).filter(Boolean).every(part => h.includes(part));
    }

    let results = all.filter(item => {
      if (!matches(item)) return false;
      if (filter === 'key' && !isKeyLike(item)) return false;
      if (filter === 'hideout' && usage(item.name).hideout <= 0) return false;
      if (filter === 'mission' && usage(item.name).missions <= 0) return false;
      if (filter === 'needed' && usage(item.name).still <= 0) return false;
      return true;
    });

    if ((filter === 'needed' || filter === 'hideout' || filter === 'mission') && !search) {
      const idx = buildRequirementIndex();
      const byKey = new Map(all.map(i => [key(i.name), i]));
      results = [...idx.values()].map(e => byKey.get(e.key) || { name:e.name, shortName:e.name, sourceHint:'requirement' }).filter(item => {
        const u = usage(item.name);
        if (filter === 'needed') return u.still > 0;
        if (filter === 'hideout') return u.hideout > 0;
        if (filter === 'mission') return u.missions > 0;
        return true;
      }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    }

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Number(state.appPrefs.v16AllItemsPage || 1);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.appPrefs.v16AllItemsPage = page;
    const start = (page - 1) * pageSize;
    const shown = results.slice(start, start + pageSize);
    if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${total} result(s)</span><span class="badge red">Needed Items manual only</span><span class="badge cyan">Strict task counts v19</span>`;

    const nav = () => `<div class="panel action-panel"><button class="small" onclick="v16AllItemsSetPage(1)" ${page <= 1 ? 'disabled' : ''}>First</button><button class="small" onclick="v16AllItemsSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button><span class="pill">Page ${page} / ${totalPages}</span><span class="pill">Showing ${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} of ${total}</span><button class="small" onclick="v16AllItemsSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button><button class="small" onclick="v16AllItemsSetPage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>Last</button></div>`;

    const rows = shown.map(item => {
      const u = usage(item.name);
      const uses = arr(u.uses).slice(0,4).map(use => {
        const title = use.type === 'hideout' ? `${use.station} L${use.level}` : `${use.mission}${use.trader ? ` / ${use.trader}` : ''}`;
        return `${esc(use.qty)}× ${esc(title)}${use.fir ? ' FIR' : ''}`;
      }).join('<br>') || 'No remaining hideout/task use found';
      const encoded = encodeURIComponent(item.name || '');
      const types = arr(item.types).slice(0,3).join(', ') || item.category || item.sourceHint || 'item';
      return `<tr><td><strong>${esc(item.name)}</strong><br><span class="meta">${esc(item.shortName || types)}${item.shortName ? ` • ${esc(types)}` : ''}</span></td><td>${esc(u.still)}</td><td>${esc(u.hideout || 0)}</td><td>${esc(u.missions || 0)}</td><td>${esc(u.have || 0)}</td><td>${uses}</td><td class="card-actions"><button class="small primary" onclick="v16TrackStillNeededEncoded('${encoded}')">Track needed</button><button class="small" onclick="v16TrackOneItemEncoded('${encoded}')">Track 1</button>${item.wikiLink ? ` <a class="buttonLink small" target="_blank" rel="noreferrer" href="${esc(item.wikiLink)}">Wiki</a>` : ''}</td></tr>`;
    }).join('');
    list.className = 'stack';
    list.innerHTML = total ? `${nav()}<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:860px;"><thead><tr><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Still need</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Hideout</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Missions</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Have</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Used for</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${nav()}` : `<div class="panel"><h2>No item results</h2><p>Try a different search. If the list is empty, use Sync Data / Sync all item list first.</p></div>`;
  }

  window.v16TrackStillNeeded = function(name){
    ensure();
    const itemName = String(name || '').trim();
    const u = usage(itemName);
    const qty = Math.max(1, u.still || u.total || 1);
    const source = u.hideout && !u.missions ? 'hideout' : (u.missions && !u.hideout ? 'quest' : 'custom');
    const note = u.total ? `Lookup total: ${u.hideout || 0} hideout + ${u.missions || 0} missions remaining` : 'Added from All Items Lookup';
    const existing = state.items.find(i => key(i.name) === key(itemName) && String(i.note || '').startsWith('Lookup total'));
    if (existing) {
      existing.needed = Math.max(num(existing.needed, 1), qty);
      existing.source = source;
      existing.note = note;
      if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id);
    } else {
      const item = { id: crypto.randomUUID(), name:itemName, needed:qty, found:0, source, note };
      state.items.push(item);
      state.tracked.push(item.id);
    }
    saveSafe();
    toastSafe(`Tracking ${qty} × ${itemName}.`);
    try { render(); } catch {}
  };

  const baseRender = (typeof render === 'function') ? render : null;
  window.render = render = function renderV19(){
    ensure();
    const active = document.querySelector('.page.active')?.id || 'dashboard';
    if (active === 'allitems') {
      try { if (typeof renderStats === 'function') renderStats(); } catch {}
      try { renderAllItems(); } catch (err) {
        console.error('v19 all-items render failed', err);
        const target = $('allItemsList') || $('allitems');
        if (target) target.innerHTML = `<div class="panel"><h2>All Items render error</h2><p>${esc(err.message || err)}</p></div>`;
      }
      return;
    }
    if (baseRender) baseRender();
  };

  try {
    ensure();
    render();
    console.info(`${BUILD} loaded: strict item usage counts active.`);
  } catch (err) {
    console.warn('v19 init warning', err);
  }
})();

/* v20 core patch loader */
/* =========================================================
   v20 patch — fast searches + stricter item-use counts
   - Keeps the supplied index.html/styles.css unchanged
   - Debounces/captures search inputs so old render listeners don't fire per key
   - Fixes category/sell-any mission objectives being counted as specific items
   - Needed Items stays manual-only; All Items remains paged/table based
   ========================================================= */
(function(){
  'use strict';
  const BUILD = 'v20-fast-search-strict-category-filter';
  const $ = id => document.getElementById(id);
  const arr = v => Array.isArray(v) ? v : [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm = s => String(s || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  const key = s => norm(s).replace(/\s+/g,'');
  const num = (v,d=1) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const toastSafe = msg => { try { if (typeof toast === 'function') toast(msg); else console.log(msg); } catch { console.log(msg); } };
  const saveSafe = () => { try { if (typeof saveState === 'function') saveState(); } catch (err) { console.warn('v20 save failed', err); } };

  let reqCacheKey = '';
  let reqCache = null;
  let knownItemsCacheKey = '';
  let knownItemsCache = null;
  let fastTimer = null;

  function ensure(){
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch {}
    window.state = window.state || {};
    state.items = arr(state.items);
    state.tracked = arr(state.tracked);
    state.apiCache = state.apiCache || {};
    state.hideoutProgress = state.hideoutProgress || {};
    state.missionProgress = state.missionProgress || {};
    state.taskObjectives = state.taskObjectives || {};
    state.appPrefs = state.appPrefs || {};
  }

  function taskNames(){
    try { return new Set(arr(state.apiCache?.tasks).map(t => key(t?.name)).filter(Boolean)); }
    catch { return new Set(); }
  }

  function isRealItem(item){
    const name = String(item?.name || item?.shortName || '').trim();
    if (!name || name.length < 2 || name.length > 90) return false;
    const k = key(name);
    if (!k) return false;
    if (taskNames().has(k)) return false;
    const badName = /(first\s*in\s*line|half[-\s]?empty|quest\s*item|transit\s*case|sealed\s*letter|letter\s*from|folder\s*with|secure\s*folder|documents?\s*case\s*\(|unknown\s*objective|subtask|objective|requirements?:)/i;
    if (badName.test(name)) return false;
    const meta = `${item?.type || ''} ${arr(item?.types).join(' ')} ${item?.category || ''}`.toLowerCase();
    if (meta.includes('questitem') || meta.includes('quest item')) return false;
    return true;
  }

  function objectiveType(o){ return String(o?.type || '').toLowerCase(); }
  function objectiveText(o){ return norm(`${o?.description || ''} ${o?.type || ''}`); }

  function isExcludedMissionObjective(o){
    const t = objectiveType(o);
    const d = objectiveText(o);
    if (!o || o.optional) return true;
    if (!t.includes('item')) return true;
    if (/questitem|useitem|mark|builditem|hideout|playerlevel|skill|trader|shoot|extract|visit|taskstatus/.test(t)) return true;
    if (o.questItem || o.markerItem || o.useAny || o.hideoutStation) return true;
    if (o.containsCategory || arr(o.containsAll).length) return true;

    // These are category / money-value / choice objectives. tarkov.dev may list many possible items,
    // but they are NOT required one-by-one, so they must not add 50x/75x/250x counts.
    const broad = [
      /sell\s+any\s+items?/, /any\s+items?\s+to\s+/, /sell\s+items?\s+to\s+/, /sell\s+.+\s+to\s+(prapor|therapist|skier|peacekeeper|mechanic|ragman|jaeger|fence)/,
      /found\s+in\s+raid\s+(military\s+)?electronic\s+items?/, /found\s+in\s+raid\s+military\s+items?/, /found\s+in\s+raid\s+medical\s+items?/, /found\s+in\s+raid\s+provisions?/, /found\s+in\s+raid\s+valuable\s+items?/, /found\s+in\s+raid\s+streamer\s+items?/, /found\s+in\s+raid\s+household\s+items?/, /found\s+in\s+raid\s+tools?/, /found\s+in\s+raid\s+building\s+materials?/, /found\s+in\s+raid\s+barter\s+items?/, /found\s+in\s+raid\s+rare\s+items?/, /found\s+in\s+raid\s+weapons?/, /found\s+in\s+raid\s+weapon\s+parts?/, /found\s+in\s+raid\s+armor/, /found\s+in\s+raid\s+equipment/,
      /hand\s+over\s+.*(military\s+)?electronic\s+items?/, /hand\s+over\s+.*medical\s+items?/, /hand\s+over\s+.*provisions?/, /hand\s+over\s+.*valuable\s+items?/, /hand\s+over\s+.*streamer\s+items?/, /hand\s+over\s+.*barter\s+items?/, /hand\s+over\s+.*rare\s+items?/, /hand\s+over\s+.*weapons?/, /hand\s+over\s+.*equipment/,
      /from\s+category/, /category\s+items?/, /one\s+of\s+the/, /any\s+of\s+the/, /any\s+weapon/, /any\s+armor/, /any\s+equipment/, /with\s+any\s+/, /wear\s+any\s+/
    ];
    return broad.some(rx => rx.test(d));
  }

  function itemMentionedInObjective(o, item){
    const d = objectiveText(o);
    if (!d) return true;
    const names = [item?.name, item?.shortName, item?.normalizedName].filter(Boolean).map(norm).filter(Boolean);
    return names.some(n => {
      if (n.length < 2) return false;
      if (d.includes(n)) return true;
      // Singular/plural helper: CPU fan ↔ CPU fans, power filter ↔ power filters.
      if (d.includes(`${n}s`)) return true;
      if (n.endsWith('s') && d.includes(n.slice(0, -1))) return true;
      return false;
    });
  }

  function objectiveItemsStrict(o){
    if (isExcludedMissionObjective(o)) return [];
    const raw = [];
    arr(o.items).forEach(i => raw.push(i));
    if (o.item) raw.push(o.item);
    const real = raw.filter(isRealItem);
    if (!real.length) return [];

    // If the API gives a large choice list, count only items explicitly named in the description.
    // This is the main fix for Military power filter showing 250 needed.
    const explicit = real.filter(i => itemMentionedInObjective(o, i));
    if (real.length > 1) {
      if (!explicit.length) return [];
    } else {
      // Single item with a generic description still should be ignored.
      if (!explicit.length && /\b(any|category|electronic items|medical items|provisions|valuable items|barter items|sell items)\b/.test(objectiveText(o))) return [];
    }

    const source = explicit.length ? explicit : real;
    const by = new Map();
    source.forEach(i => {
      const name = i.name || i.shortName;
      const k = key(name);
      if (!k) return;
      const old = by.get(k) || { key:k, id:i.id, name, shortName:i.shortName, wikiLink:i.wikiLink, iconLink:i.iconLink, count:0, foundInRaid:false };
      old.count = Math.max(Number(old.count || 0), num(i.count || o.count, 1));
      old.foundInRaid = old.foundInRaid || !!(i.foundInRaid || o.foundInRaid || /\b(in raid|found in raid|fir)\b/.test(objectiveText(o)));
      by.set(k, old);
    });
    return [...by.values()];
  }

  function getHideoutStations(){
    try { if (typeof window.getHideoutStations === 'function') return window.getHideoutStations(); } catch {}
    try { if (typeof getHideoutStations === 'function') return getHideoutStations(); } catch {}
    return arr(state.apiCache?.hideout);
  }
  function stationId(station){
    try { if (typeof hideoutStationId === 'function') return hideoutStationId(station); } catch {}
    return station?.id || station?.normalizedName || key(station?.name);
  }
  function stationLevel(station){
    const candidates = [stationId(station), station?.id, station?.normalizedName, station?.name, key(station?.name)].filter(v => v != null);
    for (const c of candidates) if (Object.prototype.hasOwnProperty.call(state.hideoutProgress || {}, c)) return Number(state.hideoutProgress[c] || 0);
    return 0;
  }
  function hideoutLevels(station){
    try { if (typeof hideoutLevels === 'function') return hideoutLevels(station); } catch {}
    return arr(station?.levels).slice().sort((a,b)=>Number(a.level||0)-Number(b.level||0));
  }
  function hideoutReqItems(level){
    try { if (typeof hideoutReqItems === 'function') return hideoutReqItems(level); } catch {}
    return arr(level?.itemRequirements).map(r => ({
      id: r.item?.id || r.id,
      name: r.item?.name || r.name || r.itemName,
      shortName: r.item?.shortName || r.shortName,
      wikiLink: r.item?.wikiLink,
      iconLink: r.item?.iconLink,
      count: num(r.count || r.quantity, 1)
    })).filter(isRealItem);
  }
  function taskDone(task){
    const s = state.missionProgress?.[task?.id];
    return s === 'done' || s === 'complete' || s === true;
  }
  function objectiveDone(task, obj, idx){
    try {
      if (typeof objectiveKey === 'function') {
        if (state.taskObjectives?.[objectiveKey(task.id, obj.id || String(idx))]) return true;
        if (obj.id && state.taskObjectives?.[objectiveKey(task.id, obj.id)]) return true;
      }
    } catch {}
    return !!state.taskObjectives?.[`${task?.id}::${obj?.id || idx}`];
  }

  function addUse(index, name, qty, use){
    if (!name || !isRealItem({name, shortName:name})) return;
    const k = key(name);
    if (!k) return;
    const entry = index.get(k) || { key:k, name, hideout:0, missions:0, uses:[] };
    const count = num(qty, 1);
    if (use.type === 'hideout') entry.hideout += count;
    if (use.type === 'mission') entry.missions += count;
    entry.uses.push({ ...use, qty: count });
    index.set(k, entry);
  }

  function cacheKey(){
    const tasks = arr(state.apiCache?.tasks);
    const hideout = arr(state.apiCache?.hideout);
    return JSON.stringify({
      sync: state.apiCache?.syncedAt || '',
      hCount: hideout.length,
      tCount: tasks.length,
      hideoutProgress: state.hideoutProgress || {},
      missionProgress: state.missionProgress || {},
      taskObjectives: state.taskObjectives || {},
      found: arr(state.items).map(i => [key(i.name), Number(i.found || 0)])
    });
  }

  function buildRequirementIndex(){
    ensure();
    const ck = cacheKey();
    if (reqCache && reqCacheKey === ck) return reqCache;
    const index = new Map();

    getHideoutStations().forEach(station => {
      const current = stationLevel(station);
      hideoutLevels(station).forEach(level => {
        const lvl = Number(level?.level || 0);
        if (!lvl || lvl <= current) return;
        hideoutReqItems(level).forEach(req => addUse(index, req.name || req.shortName, req.count, {
          type:'hideout', station:station?.name || stationId(station) || 'Hideout station', level:lvl,
          note:`${station?.name || 'Hideout'} level ${lvl}`
        }));
      });
    });

    arr(state.apiCache?.tasks).forEach(task => {
      if (!task || taskDone(task)) return;
      const perTaskItem = new Map();
      arr(task.objectives).forEach((o, idx) => {
        if (objectiveDone(task, o, idx)) return;
        objectiveItemsStrict(o).forEach(item => {
          const k = key(item.name || item.shortName);
          if (!k) return;
          const old = perTaskItem.get(k) || { key:k, name:item.name || item.shortName, count:0, foundInRaid:false, notes:[] };
          old.count = Math.max(Number(old.count || 0), num(item.count || o.count, 1));
          old.foundInRaid = old.foundInRaid || !!item.foundInRaid;
          const note = String(o.description || o.type || '').trim();
          if (note && !old.notes.includes(note)) old.notes.push(note);
          perTaskItem.set(k, old);
        });
      });
      perTaskItem.forEach(item => addUse(index, item.name, item.count, {
        type:'mission', mission:task.name || 'Mission/task', trader:task.trader?.name || '', fir:!!item.foundInRaid,
        note:item.notes.slice(0,2).join(' / ')
      }));
    });

    reqCacheKey = ck;
    reqCache = index;
    window.v20RequirementIndex = index;
    return index;
  }

  function haveForItem(itemName){
    const q = key(itemName);
    return arr(state.items).reduce((sum, i) => key(i.name) === q ? sum + Number(i.found || 0) : sum, 0);
  }
  function exactRequirement(itemName){
    const q = key(itemName);
    const idx = buildRequirementIndex();
    if (idx.has(q)) return idx.get(q);
    return null;
  }
  function findRequirement(itemName){
    const exact = exactRequirement(itemName);
    if (exact) return exact;
    const qNorm = norm(itemName);
    if (!qNorm || qNorm.length < 3) return null;
    const idx = buildRequirementIndex();
    for (const e of idx.values()) {
      const eNorm = norm(e.name);
      if (eNorm === qNorm || eNorm.includes(qNorm) || qNorm.includes(eNorm)) return e;
    }
    return null;
  }
  function usage(itemName){
    const entry = findRequirement(itemName) || { key:key(itemName), name:itemName, hideout:0, missions:0, uses:[] };
    const total = Number(entry.hideout || 0) + Number(entry.missions || 0);
    const have = haveForItem(entry.name || itemName);
    return { ...entry, total, have, still: Math.max(0, total - have) };
  }
  window.v19ItemUsage = usage;
  window.v20ItemUsage = usage;

  function knownItems(){
    ensure();
    const ck = JSON.stringify({
      all: arr(state.apiCache?.allItems).length,
      keys: arr(state.apiCache?.keys).length,
      hideout: arr(state.apiCache?.hideout).length,
      tasks: arr(state.apiCache?.tasks).length,
      tracked: arr(state.items).length,
      sync: state.apiCache?.syncedAt || ''
    });
    if (knownItemsCache && knownItemsCacheKey === ck) return knownItemsCache;
    const map = new Map();
    const add = (item, sourceHint='') => {
      if (!isRealItem(item)) return;
      const name = item.name || item.shortName;
      const k = key(name);
      if (!k) return;
      const old = map.get(k) || {};
      map.set(k, { ...old, ...item, name: old.name || name, shortName: old.shortName || item.shortName, sourceHint: old.sourceHint || sourceHint });
    };
    arr(state.apiCache?.allItems).forEach(i => add(i, 'all-items'));
    arr(state.apiCache?.keys).forEach(k => add({ ...k, types:[...(arr(k.types)), 'Key'] }, 'keys'));
    getHideoutStations().forEach(station => hideoutLevels(station).forEach(level => hideoutReqItems(level).forEach(req => add(req, 'hideout'))));
    arr(state.apiCache?.tasks).forEach(task => arr(task.objectives).forEach(o => objectiveItemsStrict(o).forEach(i => add(i, 'tasks'))));
    arr(state.items).forEach(i => add(i, 'tracked'));
    knownItemsCacheKey = ck;
    knownItemsCache = [...map.values()].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    return knownItemsCache;
  }

  function isKeyLike(item){
    const t = `${arr(item?.types).join(' ')} ${item?.category || ''} ${item?.name || ''} ${item?.shortName || ''}`.toLowerCase();
    return t.includes('key') || t.includes('keycard');
  }

  function renderUsePanel(searchText){
    const needed = $('needed');
    const list = $('itemList');
    if (!needed || !list) return;
    let panel = $('v15ItemUsePanel') || $('v20ItemUsePanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'v20ItemUsePanel';
      panel.className = 'panel readable';
      panel.style.display = 'none';
      list.parentNode.insertBefore(panel, list);
    }
    const q = String(searchText || '').trim();
    if (!q) { panel.style.display = 'none'; panel.innerHTML = ''; return; }
    const summary = usage(q);
    const exactName = summary.name || q;
    const uses = arr(summary.uses);
    const useList = uses.slice(0, 18).map(u => {
      const title = u.type === 'hideout'
        ? `Hideout: ${u.station || 'Station'} level ${u.level || ''}`.trim()
        : `Mission: ${u.mission || 'Task'}${u.trader ? ` / ${u.trader}` : ''}`;
      return `<li><strong>${esc(u.qty)}×</strong> ${esc(title)}${u.fir ? ' <span class="badge cyan">FIR</span>' : ''}${u.note ? `<br><small class="meta">${esc(u.note)}</small>` : ''}</li>`;
    }).join('');
    const otherMatches = [...buildRequirementIndex().values()]
      .map(e => e.name)
      .filter(n => n && norm(n).includes(norm(q)) && key(n) !== key(exactName))
      .slice(0, 7);
    panel.style.display = '';
    panel.innerHTML = `
      <h2>Item use lookup: ${esc(exactName)}</h2>
      <p>Progress-aware count. Hideout levels you already marked as built are ignored. Broad mission objectives like “sell any items” or “military electronic items” are ignored so they do not inflate counts.</p>
      <div class="stats">
        <div class="stat"><strong>${esc(summary.still)}</strong><span>Still need</span></div>
        <div class="stat"><strong>${esc(summary.total)}</strong><span>Total remaining</span></div>
        <div class="stat"><strong>${esc(summary.hideout || 0)}</strong><span>Hideout left</span></div>
        <div class="stat"><strong>${esc(summary.missions || 0)}</strong><span>Missions left</span></div>
        <div class="stat"><strong>${esc(summary.have)}</strong><span>Tracker says have</span></div>
      </div>
      ${uses.length ? `<h3>Where this is still used</h3><ul>${useList}</ul>${uses.length > 18 ? `<p class="meta">+ ${uses.length - 18} more uses. Narrow your search for more detail.</p>` : ''}` : `<p>No synced hideout/task usage found for <strong>${esc(q)}</strong>. Try the full item name or sync Tarkov data.</p>`}
      ${otherMatches.length ? `<p class="meta">Other matching items: ${otherMatches.map(n => `<button class="small ghost" type="button" onclick="document.getElementById('searchInput').value='${esc(n).replace(/'/g, '&#39;')}'; render();">${esc(n)}</button>`).join(' ')}</p>` : ''}
    `;
  }

  const baseRenderItems = (typeof renderItems === 'function') ? renderItems : null;
  window.renderItems = renderItems = function renderItemsV20(){
    ensure();
    const search = String($('searchInput')?.value || '').trim().toLowerCase();
    const filter = $('filterSelect')?.value || 'all';
    const list = $('itemList');
    const template = $('itemTemplate');
    if (!list || !template) return baseRenderItems && baseRenderItems();
    renderUsePanel(search);
    const filtered = arr(state.items).filter(item => {
      const text = `${item?.name || ''} ${item?.source || ''} ${item?.note || ''}`.toLowerCase();
      const matchesSearch = !search || text.includes(search);
      const isTracked = arr(state.tracked).includes(item.id);
      const unfinished = Number(item?.found || 0) < Number(item?.needed || 0);
      const matchesFilter = filter === 'all' ||
        (filter === 'tracked' && isTracked) ||
        (filter === 'unfinished' && unfinished) ||
        item?.source === filter;
      return matchesSearch && matchesFilter;
    });
    list.innerHTML = '';
    if (!filtered.length) {
      list.innerHTML = `<div class="panel"><p>Needed Items is manual only. Search in <strong>All Items Lookup</strong> and press Track needed, or add an item from Custom Track.</p></div>`;
      return;
    }
    const maxCards = search ? 80 : 160;
    filtered.slice(0, maxCards).forEach(item => {
      const clone = template.content.cloneNode(true);
      const isTracked = arr(state.tracked).includes(item.id);
      const progress = (typeof itemProgress === 'function') ? itemProgress(item) : Number(item.found || 0);
      const percent = item.needed ? (progress / item.needed) * 100 : 0;
      clone.querySelector('.name').textContent = item.name;
      clone.querySelector('.meta').textContent = item.note || 'No note';
      clone.querySelector('.pill').textContent = item.source || 'custom';
      clone.querySelector('.progress-text').textContent = `${progress} / ${item.needed} collected`;
      clone.querySelector('.bar span').style.width = `${Math.min(100, percent)}%`;
      const trackBtn = clone.querySelector('.trackBtn');
      trackBtn.textContent = isTracked ? 'Untrack' : 'Track';
      trackBtn.onclick = () => toggleTrack(item.id);
      clone.querySelector('.minusBtn').onclick = () => adjustFound(item.id, -1);
      clone.querySelector('.plusBtn').onclick = () => adjustFound(item.id, 1);
      clone.querySelector('.foundBtn').onclick = () => addRaidFound(item.id);
      clone.querySelector('.deleteBtn').onclick = () => deleteItem(item.id);
      list.appendChild(clone);
    });
    if (filtered.length > maxCards) {
      const more = document.createElement('div');
      more.className = 'panel';
      more.innerHTML = `<p>Showing ${maxCards} of ${filtered.length} tracked items. Use search/filter to narrow it down.</p>`;
      list.appendChild(more);
    }
  };

  function renderAllItems(){
    ensure();
    const summaryEl = $('allItemSummary');
    const list = $('allItemsList');
    if (!list) return;
    const searchRaw = String($('allItemSearch')?.value || '').trim();
    const search = norm(searchRaw);
    const filter = $('allItemFilter')?.value || 'all';
    const all = knownItems();
    const pageSize = 50;
    if (!search && (filter === 'all' || filter === 'key')) {
      const keyCount = all.reduce((n,i)=>n + (isKeyLike(i) ? 1 : 0),0);
      if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${keyCount} key/keycard records</span><span class="badge red">Search before rendering list</span><span class="badge cyan">v20 strict counts</span>`;
      list.className = 'stack';
      list.innerHTML = `<div class="panel readable"><h2>Search the item database</h2><p>Type an item name like <strong>CPU fan</strong>, <strong>Military power filter</strong>, <strong>Wires</strong>, or <strong>Toolset</strong>. Results stay hidden until you search so Chrome does not hang.</p><p class="meta">Needed Items will stay empty until you press Track needed or Track 1.</p></div>`;
      return;
    }
    function hay(item){ return norm(`${item?.name || ''} ${item?.shortName || ''} ${item?.normalizedName || ''} ${arr(item?.types).join(' ')} ${item?.category || ''}`); }
    function matches(item){
      if (!search) return true;
      const h = hay(item);
      return search.split(/\s+/).filter(Boolean).every(part => h.includes(part));
    }
    let results;
    if ((filter === 'needed' || filter === 'hideout' || filter === 'mission') && !search) {
      const idx = buildRequirementIndex();
      const byKey = new Map(all.map(i => [key(i.name), i]));
      results = [...idx.values()].map(e => byKey.get(e.key) || { name:e.name, shortName:e.name, sourceHint:'requirement' }).filter(item => {
        const u = usage(item.name);
        if (filter === 'needed') return u.still > 0;
        if (filter === 'hideout') return u.hideout > 0;
        if (filter === 'mission') return u.missions > 0;
        return true;
      }).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    } else {
      results = all.filter(item => {
        if (!matches(item)) return false;
        if (filter === 'key' && !isKeyLike(item)) return false;
        if (filter === 'hideout' || filter === 'mission' || filter === 'needed') {
          const u = usage(item.name);
          if (filter === 'hideout' && u.hideout <= 0) return false;
          if (filter === 'mission' && u.missions <= 0) return false;
          if (filter === 'needed' && u.still <= 0) return false;
        }
        return true;
      });
    }
    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Number(state.appPrefs.v20AllItemsPage || state.appPrefs.v16AllItemsPage || 1);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    state.appPrefs.v20AllItemsPage = page;
    const start = (page - 1) * pageSize;
    const shown = results.slice(start, start + pageSize);
    if (summaryEl) summaryEl.innerHTML = `<span class="badge gold">${all.length} known items</span><span class="badge cyan">${arr(state.apiCache?.allItems).length} synced item records</span><span class="badge green">${total} result(s)</span><span class="badge red">Needed Items manual only</span><span class="badge cyan">v20 strict counts</span>`;
    const nav = () => `<div class="panel action-panel"><button class="small" onclick="v20AllItemsSetPage(1)" ${page <= 1 ? 'disabled' : ''}>First</button><button class="small" onclick="v20AllItemsSetPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>Prev</button><span class="pill">Page ${page} / ${totalPages}</span><span class="pill">Showing ${total ? start + 1 : 0}-${Math.min(start + pageSize, total)} of ${total}</span><button class="small" onclick="v20AllItemsSetPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>Next</button><button class="small" onclick="v20AllItemsSetPage(${totalPages})" ${page >= totalPages ? 'disabled' : ''}>Last</button></div>`;
    const rows = shown.map(item => {
      const u = usage(item.name);
      const uses = arr(u.uses).slice(0,4).map(use => {
        const title = use.type === 'hideout' ? `${use.station} L${use.level}` : `${use.mission}${use.trader ? ` / ${use.trader}` : ''}`;
        return `${esc(use.qty)}× ${esc(title)}${use.fir ? ' FIR' : ''}`;
      }).join('<br>') || 'No remaining hideout/task use found';
      const encoded = encodeURIComponent(item.name || '');
      const types = arr(item.types).slice(0,3).join(', ') || item.category || item.sourceHint || 'item';
      return `<tr><td><strong>${esc(item.name)}</strong><br><span class="meta">${esc(item.shortName || types)}${item.shortName ? ` • ${esc(types)}` : ''}</span></td><td>${esc(u.still)}</td><td>${esc(u.hideout || 0)}</td><td>${esc(u.missions || 0)}</td><td>${esc(u.have || 0)}</td><td>${uses}</td><td class="card-actions"><button class="small primary" onclick="v16TrackStillNeededEncoded('${encoded}')">Track needed</button><button class="small" onclick="v16TrackOneItemEncoded('${encoded}')">Track 1</button>${item.wikiLink ? ` <a class="buttonLink small" target="_blank" rel="noreferrer" href="${esc(item.wikiLink)}">Wiki</a>` : ''}</td></tr>`;
    }).join('');
    list.className = 'stack';
    list.innerHTML = total ? `${nav()}<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:860px;"><thead><tr><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Still need</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Hideout</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Missions</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Have</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Used for</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${nav()}` : `<div class="panel"><h2>No item results</h2><p>Try a different search. If the list is empty, use Sync Data / Sync all item list first.</p></div>`;
  }

  window.v20AllItemsSetPage = function(page){ ensure(); state.appPrefs.v20AllItemsPage = Math.max(1, Number(page) || 1); renderAllItems(); };
  // Keep old onclicks working.
  window.v16AllItemsSetPage = window.v20AllItemsSetPage;

  window.v16TrackStillNeeded = function(name){
    ensure();
    const itemName = String(name || '').trim();
    if (!itemName) return;
    const u = usage(itemName);
    const qty = Math.max(1, u.still || u.total || 1);
    const source = u.hideout && !u.missions ? 'hideout' : (u.missions && !u.hideout ? 'quest' : 'custom');
    const note = u.total ? `Lookup total: ${u.hideout || 0} hideout + ${u.missions || 0} missions remaining` : 'Added from All Items Lookup';
    const existing = state.items.find(i => key(i.name) === key(itemName) && String(i.note || '').startsWith('Lookup total'));
    if (existing) {
      existing.needed = Math.max(num(existing.needed, 1), qty);
      existing.source = source;
      existing.note = note;
      if (!state.tracked.includes(existing.id)) state.tracked.push(existing.id);
    } else {
      const item = { id: crypto.randomUUID(), name:itemName, needed:qty, found:0, source, note };
      state.items.push(item);
      state.tracked.push(item.id);
    }
    saveSafe();
    toastSafe(`Tracking ${qty} × ${itemName}.`);
    try { render(); } catch {}
  };
  window.v16TrackStillNeededEncoded = function(encoded){ window.v16TrackStillNeeded(decodeURIComponent(encoded || '')); };

  const baseRender = (typeof render === 'function') ? render : null;
  function safeActiveRender(){
    ensure();
    const active = document.querySelector('.page.active')?.id || 'dashboard';
    try { if (typeof renderStats === 'function') renderStats(); } catch {}
    if (active === 'needed') return renderItems();
    if (active === 'allitems') return renderAllItems();
    if (baseRender) return baseRender();
  }
  window.render = render = function renderV20(){
    try { safeActiveRender(); } catch (err) {
      console.error('v20 render failed', err);
      const active = document.querySelector('.page.active');
      const target = active?.querySelector('#allItemsList,#itemList,#hideoutList,#taskList,#mapDetail,#keysList,#lockerList,#storyList') || active;
      if (target) target.innerHTML = `<div class="panel"><h2>Render error</h2><p>${esc(err.message || err)}</p></div>`;
    }
  };

  // Block older addEventListener(input, render) handlers that fired on every keypress.
  const fastFields = new Set(['searchInput','mapSearch','keySearch','lockerSearch','taskSearch','storySearch','hideoutSearch','allItemSearch']);
  const fastSelects = new Set(['filterSelect','keyMapFilter','lockerFilter','lockerMapFilter','taskTraderFilter','allItemFilter','hideoutFilter']);
  function scheduleRender(immediate=false){
    clearTimeout(fastTimer);
    fastTimer = setTimeout(() => { try { render(); } catch (err) { console.error('v20 debounced render failed', err); } }, immediate ? 10 : 240);
  }
  document.addEventListener('input', function(e){
    const id = e.target && e.target.id;
    if (!fastFields.has(id) && !fastSelects.has(id)) return;
    e.stopImmediatePropagation();
    if (id === 'allItemSearch' || id === 'searchInput') state.appPrefs.v20AllItemsPage = 1;
    scheduleRender(false);
  }, true);
  document.addEventListener('change', function(e){
    const id = e.target && e.target.id;
    if (!fastFields.has(id) && !fastSelects.has(id)) return;
    e.stopImmediatePropagation();
    if (id === 'allItemFilter') state.appPrefs.v20AllItemsPage = 1;
    scheduleRender(true);
  }, true);

  try {
    ensure();
    console.info(`${BUILD} loaded. Military power filter should now show hideout only (unless a specific synced task names it).`);
  } catch (err) { console.warn('v20 init warning', err); }
})();
/* ===== v21 key intel fixes =====
   - Keeps uploaded index.html/styles.css unchanged.
   - Adds safe offline fallback intel for Key 03 / numbered Labyrinth keys.
   - Makes the wiki lookup less brittle by using the MediaWiki wikitext API fallback.
   - Starts a tiny background lookup only when the visible key list is small, so searches don't hang.
*/
(function(){
  const BUILD = 'v21-key-intel';
  const KEY_AUTO_LOOKUP_LIMIT = 3;
  let keyLookupTimer = null;
  const inFlight = new Set();
  const attempted = new Set();

  function k(s){ return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function canUseState(){ return typeof state === 'object' && state; }
  function ensureKeyIntel(){
    try { if (typeof ensureV10State === 'function') ensureV10State(); } catch {}
    if (!canUseState()) return;
    state.keyIntel = state.keyIntel || {};
    state.appPrefs = state.appPrefs || {};
  }

  const KNOWN_KEY_INTEL = {
    'key-03': {
      map: 'The Labyrinth',
      lockLocation: 'Spawn chamber 3 inside The Labyrinth. Far door.',
      keyLocation: 'Different locations in spawn chamber 3 inside The Labyrinth: in the hand of the dead Scav, next to the candles at the wooden beam, in the broken bottle in front of the far door, or in the blue trash bag next to the far door.',
      behindLock: 'Area where the BBQ-S43 gas torch can be found.',
      wikiTitle: 'Key 03',
      wikiLink: 'https://escapefromtarkov.fandom.com/wiki/Key_03',
      source: 'local wiki fallback'
    }
  };

  function labyrinthNumberedKeyFallback(name){
    const m = String(name || '').trim().match(/^Key\s*0?([1-4])$/i);
    if (!m) return null;
    const id = `key-0${m[1]}`;
    if (KNOWN_KEY_INTEL[id]) return KNOWN_KEY_INTEL[id];
    return {
      map: 'The Labyrinth',
      lockLocation: `Numbered Labyrinth key ${m[1]}. Use Wiki lookup for the exact chamber/door.`,
      keyLocation: 'The Labyrinth key spawn. Use Wiki lookup for exact spawn notes.',
      behindLock: '',
      wikiTitle: `Key 0${m[1]}`,
      wikiLink: `https://escapefromtarkov.fandom.com/wiki/Key_0${m[1]}`,
      source: 'local key-name fallback'
    };
  }

  function seedKnownKeyIntel(){
    ensureKeyIntel();
    if (!canUseState()) return;
    for (const [id, intel] of Object.entries(KNOWN_KEY_INTEL)) {
      const current = state.keyIntel[id] || {};
      if (!current.lockLocation || String(current.lockLocation).toLowerCase().includes('no lock')) {
        state.keyIntel[id] = { ...current, ...intel, enrichedAt: current.enrichedAt || new Date().toISOString(), error: '' };
      }
    }
  }

  function decodeHtmlEntities(str){
    const d = document.createElement('textarea');
    d.innerHTML = String(str || '');
    return d.value;
  }

  function cleanWikiText(text){
    return decodeHtmlEntities(String(text || '')
      .replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<ref[\s\S]*?<\/ref>/gi, ' ')
      .replace(/<ref[^>]*\/>/gi, ' ')
      .replace(/\{\{[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}/g, ' ')
      .replace(/\[\[File:[^\]]+\]\]/gi, ' ')
      .replace(/\[\[Image:[^\]]+\]\]/gi, ' ')
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
      .replace(/'''?/g, '')
      .replace(/^\s*[*#:;]+\s*/gm, '')
      .replace(/\|[^\n]+=/g, ' ')
      .replace(/\s+/g, ' ')
      .trim());
  }

  function sectionFromWikitext(wiki, heading){
    const wanted = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\n)==+\\s*${wanted}\\s*==+\\s*([\\s\\S]*?)(?=\\n==+\\s*[^=]+\\s*==+|$)`, 'i');
    const m = String(wiki || '').match(re);
    return m ? cleanWikiText(m[2]) : '';
  }

  async function fetchWikiWikitextIntelForKey(key){
    const title = (typeof wikiTitleFromKey === 'function') ? wikiTitleFromKey(key) : String(key?.name || '').trim().replace(/\s+/g, '_');
    const url = `https://escapefromtarkov.fandom.com/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}&rvprop=content&rvslots=main&format=json&redirects=1&origin=*`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wiki source ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.info || json.error.code || 'wiki source error');
    const pages = json?.query?.pages || {};
    const page = Object.values(pages)[0] || {};
    const rev = (page.revisions || [])[0] || {};
    const wiki = rev?.slots?.main?.['*'] || rev?.['*'] || '';
    if (!wiki) throw new Error('wiki source empty');
    const lockLocation = sectionFromWikitext(wiki, 'Lock Location');
    const keyLocation = sectionFromWikitext(wiki, 'Key Location');
    const behindLock = sectionFromWikitext(wiki, 'Behind the Lock');
    const usage = sectionFromWikitext(wiki, 'Usage');
    const lock = lockLocation || usage || '';
    const map = (typeof inferMapFromText === 'function') ? inferMapFromText([lock, keyLocation, behindLock, key?.name].join(' ')) : '';
    return {
      lockLocation: lock,
      keyLocation,
      behindLock,
      map,
      wikiTitle: page.title || title,
      wikiLink: `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(page.title || title).replace(/%20/g, '_')}`
    };
  }

  // Patch the existing wiki fetch: try the old HTML parser first, then source/wikitext parser,
  // then known local fallback. This fixes pages where the HTML parse does not expose the section cleanly.
  const oldFetchWikiIntel = (typeof fetchWikiIntelForKey === 'function') ? fetchWikiIntelForKey : null;
  window.fetchWikiIntelForKey = fetchWikiIntelForKey = async function fetchWikiIntelForKeyV21(key){
    const fallback = KNOWN_KEY_INTEL[k(key?.name)] || labyrinthNumberedKeyFallback(key?.name);
    try {
      if (oldFetchWikiIntel) {
        const intel = await oldFetchWikiIntel(key);
        if (intel && (intel.lockLocation || intel.keyLocation || intel.behindLock || intel.map)) {
          return { ...fallback, ...intel, map: intel.map || fallback?.map || '' };
        }
      }
    } catch (err) {
      // Keep trying with source API below.
      console.warn('v21 HTML wiki lookup fallback:', err?.message || err);
    }
    try {
      const intel = await fetchWikiWikitextIntelForKey(key);
      if (intel && (intel.lockLocation || intel.keyLocation || intel.behindLock || intel.map)) {
        return { ...fallback, ...intel, map: intel.map || fallback?.map || '' };
      }
    } catch (err) {
      console.warn('v21 wikitext wiki lookup fallback:', err?.message || err);
    }
    if (fallback) return fallback;
    throw new Error('No wiki lock location found');
  };

  // Patch merge so known key data is visible immediately, even before online lookup is clicked.
  const oldMerge = (typeof mergeKeyIntel === 'function') ? mergeKeyIntel : null;
  window.mergeKeyIntel = mergeKeyIntel = function mergeKeyIntelV21(key){
    ensureKeyIntel();
    seedKnownKeyIntel();
    const merged = oldMerge ? oldMerge(key) : { ...key };
    const fallback = KNOWN_KEY_INTEL[k(merged?.name || key?.name)] || labyrinthNumberedKeyFallback(merged?.name || key?.name);
    if (!fallback) return merged;
    const currentGeneric = (typeof isGenericKeyLocation === 'function') ? isGenericKeyLocation(merged.location) : !merged.location;
    const maps = Array.from(new Set([...(merged.maps || []), merged.map, fallback.map].filter(Boolean)));
    return {
      ...merged,
      maps,
      map: maps[0] || fallback.map || merged.map || '',
      location: currentGeneric ? fallback.lockLocation : merged.location,
      keyLocation: merged.keyLocation || fallback.keyLocation || '',
      behindLock: merged.behindLock || fallback.behindLock || '',
      wikiLink: merged.wikiLink || fallback.wikiLink || '',
      wikiEnrichedAt: merged.wikiEnrichedAt || (fallback.source ? new Date().toISOString() : '')
    };
  };

  function shouldLookupKey(info){
    if (!info || !info.name) return false;
    const id = k(info.name);
    if (attempted.has(id) || inFlight.has(id)) return false;
    const generic = (typeof isGenericKeyLocation === 'function') ? isGenericKeyLocation(info.location) : !info.location;
    return generic || !(info.maps || [info.map]).filter(Boolean).length;
  }

  async function lookupOneSilent(info){
    const id = k(info.name);
    attempted.add(id);
    inFlight.add(id);
    try {
      const intel = await window.fetchWikiIntelForKey(info);
      ensureKeyIntel();
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), ...intel, enrichedAt: new Date().toISOString(), error: '' };
      try { if (typeof safePersistState === 'function') safePersistState(); else if (typeof save === 'function') save(); else localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      try { if (typeof render === 'function') render(); } catch {}
    } catch (err) {
      ensureKeyIntel();
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), error: err.message || String(err), enrichedAt: new Date().toISOString() };
    } finally {
      inFlight.delete(id);
    }
  }

  function autoLookupSmallKeyResults(){
    clearTimeout(keyLookupTimer);
    keyLookupTimer = setTimeout(() => {
      try {
        const active = document.querySelector('.page.active')?.id;
        if (active !== 'keys' && active !== 'keylocker') return;
        let filtered = [];
        if (typeof filteredKeysForPage === 'function' && active === 'keys') filtered = filteredKeysForPage();
        else if (typeof allKnownKeys === 'function') {
          const q = (document.getElementById(active === 'keylocker' ? 'lockerSearch' : 'keySearch')?.value || '').toLowerCase();
          if (!q || q.length < 3) return;
          filtered = allKnownKeys().filter(x => String(x.name || '').toLowerCase().includes(q));
        }
        if (!filtered.length || filtered.length > KEY_AUTO_LOOKUP_LIMIT) return;
        filtered.map(x => mergeKeyIntel(x)).filter(shouldLookupKey).slice(0, KEY_AUTO_LOOKUP_LIMIT).forEach(lookupOneSilent);
      } catch (err) { console.warn('v21 auto key lookup skipped', err); }
    }, 650);
  }

  const oldRenderKeys = (typeof renderKeys === 'function') ? renderKeys : null;
  if (oldRenderKeys) {
    window.renderKeys = renderKeys = function renderKeysV21(){
      seedKnownKeyIntel();
      const result = oldRenderKeys();
      autoLookupSmallKeyResults();
      return result;
    };
  }

  const oldRenderKeyLocker = (typeof renderKeyLocker === 'function') ? renderKeyLocker : null;
  if (oldRenderKeyLocker) {
    window.renderKeyLocker = renderKeyLocker = function renderKeyLockerV21(){
      seedKnownKeyIntel();
      const result = oldRenderKeyLocker();
      autoLookupSmallKeyResults();
      return result;
    };
  }

  try {
    seedKnownKeyIntel();
    console.info(`${BUILD} loaded. Key 03 and numbered Labyrinth keys now get Labyrinth/key-location fallback, with better wiki extraction.`);
  } catch (err) { console.warn('v21 key intel init warning', err); }
})();
/* ===== v22 wiki Category:Keys resolver =====
   - Keeps uploaded index.html/styles.css unchanged.
   - Pulls the page list from Escape from Tarkov Wiki Category:Keys.
   - Resolves tarkov.dev key names against wiki page titles before lookup.
   - Extracts Lock Location / Key Location / Behind the Lock from wiki wikitext.
   - Uses Lock Location text first for map inference, so phrases like "Streets of Tarkov" set the right map.
*/
(function(){
  const BUILD = 'v22-wiki-category-keys';
  const CATEGORY_API = 'https://escapefromtarkov.fandom.com/api.php';
  const CATEGORY_TITLE = 'Category:Keys';
  const CATEGORY_DELAY_MS = 130;
  const AUTO_LOOKUP_LIMIT = 2;
  let autoTimer = null;
  let categorySyncRunning = false;

  function safeText(s){ return String(s ?? '').trim(); }
  function esc(s){ return (typeof escapeHtml === 'function') ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function kid(s){ return (typeof keyId === 'function') ? keyId(String(s || '')) : String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function delay(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
  function wikiLinkForTitle(title){ return `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(String(title || '').replace(/ /g, '_')).replace(/%20/g, '_')}`; }
  function setStatus(msg){ const el = document.getElementById('keyEnrichStatus'); if (el) el.textContent = msg; console.info('[key wiki]', msg); }
  function persist(noRender = true){
    try {
      if (typeof safePersistState === 'function') return safePersistState(noRender);
      if (typeof save === 'function') return save();
      if (typeof state === 'object') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) { console.warn('v22 key cache save warning', err); }
  }
  function ensureKeyState(){
    try { if (typeof ensureV10State === 'function') ensureV10State(); } catch {}
    try { if (typeof ensureV13State === 'function') ensureV13State(); } catch {}
    if (typeof state !== 'object' || !state) return false;
    state.keyIntel = state.keyIntel || {};
    state.keyWikiCategory = state.keyWikiCategory || { titles: [], syncedAt: null };
    state.apiCache = state.apiCache || {};
    state.apiCache.keys = Array.isArray(state.apiCache.keys) ? state.apiCache.keys : [];
    return true;
  }

  function decodeEntities(str){
    try { const t = document.createElement('textarea'); t.innerHTML = String(str || ''); return t.value; }
    catch { return String(str || ''); }
  }
  function normTitle(s){
    return decodeEntities(String(s || ''))
      .replace(/_/g, ' ')
      .replace(/%27/g, "'")
      .replace(/[’`]/g, "'")
      .replace(/&/g, ' and ')
      .replace(/\b(the)\b/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function compactTitleKey(s){ return normTitle(s).replace(/\s+/g, ''); }
  function titleFromLink(link){
    const m = String(link || '').match(/\/wiki\/([^?#]+)/i);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : '';
  }
  function titleCandidatesForKey(key){
    const name = safeText(key?.name);
    const shortName = safeText(key?.shortName);
    const linkTitle = titleFromLink(key?.wikiLink);
    const out = [linkTitle, name, shortName].filter(Boolean);
    if (name) {
      out.push(name.replace(/\s+/g, '_'));
      out.push(name.replace(/'/g, '%27'));
      if (/^Key\s*\d$/i.test(name)) out.push(name.replace(/(\d)$/,'0$1'));
      if (/^Key\s*0\d$/i.test(name)) out.push(name.replace(/0(\d)$/,'$1'));
    }
    return [...new Set(out.map(s => String(s).replace(/_/g, ' ').trim()).filter(Boolean))];
  }
  function categoryTitles(){
    ensureKeyState();
    return Array.isArray(state?.keyWikiCategory?.titles) ? state.keyWikiCategory.titles : [];
  }
  function resolveWikiTitleFromCategory(key){
    const titles = categoryTitles();
    const candidates = titleCandidatesForKey(key);
    if (!titles.length) return candidates[0] || safeText(key?.name);

    const byNorm = new Map();
    const byCompact = new Map();
    for (const title of titles) {
      const n = normTitle(title);
      if (!byNorm.has(n)) byNorm.set(n, title);
      const c = compactTitleKey(title);
      if (!byCompact.has(c)) byCompact.set(c, title);
    }

    for (const c of candidates) {
      const n = normTitle(c);
      if (byNorm.has(n)) return byNorm.get(n);
      const compact = compactTitleKey(c);
      if (byCompact.has(compact)) return byCompact.get(compact);
    }

    // Last-resort fuzzy match for cases where tarkov.dev and wiki have tiny wording differences.
    const main = normTitle(candidates[0] || key?.name || '');
    if (main.length >= 8) {
      let best = null;
      let bestScore = 0;
      const words = main.split(' ').filter(w => w.length > 1);
      for (const title of titles) {
        const tn = normTitle(title);
        if (!tn) continue;
        let score = 0;
        for (const w of words) if (tn.includes(w)) score += w.length;
        if ((tn.includes(main) || main.includes(tn)) && Math.min(tn.length, main.length) > 5) score += 20;
        if (score > bestScore) { bestScore = score; best = title; }
      }
      if (best && bestScore >= Math.max(12, Math.floor(main.length * 0.55))) return best;
    }
    return candidates[0] || safeText(key?.name);
  }

  function cleanWikiText(text){
    let s = String(text || '');
    // Remove noisy blocks first.
    s = s.replace(/<!--([\s\S]*?)-->/g, ' ')
      .replace(/<ref[\s\S]*?<\/ref>/gi, ' ')
      .replace(/<ref[^>]*\/>/gi, ' ')
      .replace(/\{\|[\s\S]*?\|\}/g, ' ')
      .replace(/\[\[File:[^\]]+\]\]/gi, ' ')
      .replace(/\[\[Image:[^\]]+\]\]/gi, ' ');
    // Remove nested templates in a few passes.
    for (let i = 0; i < 5; i++) s = s.replace(/\{\{[^{}]*\}\}/g, ' ');
    s = s.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
      .replace(/'''?/g, '')
      .replace(/^\s*[*#:;]+\s*/gm, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return decodeEntities(s);
  }
  function sectionFromWikitext(wiki, headings){
    const list = Array.isArray(headings) ? headings : [headings];
    const source = String(wiki || '').replace(/\r\n/g, '\n');
    for (const heading of list) {
      const wanted = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\n)==+\\s*${wanted}\\s*==+\\s*([\\s\\S]*?)(?=\\n==+\\s*[^=]+\\s*==+|$)`, 'i');
      const m = source.match(re);
      if (m) {
        const cleaned = cleanWikiText(m[2]);
        if (cleaned) return cleaned;
      }
    }
    return '';
  }
  function v22InferMap(text){
    const hay = String(text || '').toLowerCase();
    if (!hay) return '';
    const localAliases = [
      ['Streets of Tarkov', ['streets of tarkov','streets','zmeisky','zmeiskij','zmeevsky','zmeevskij','zmejskij','zmejsky','pinewood','beluga','concordia','chekannaya','lexos','aspect company','cardinal','x-ray room','archive room']],
      ['Shoreline', ['shoreline','health resort','west wing','east wing','sanatorium','azure coast']],
      ['Customs', ['customs','dorm','dorms','tarcone','big red','trailer park','gas station','machinery','portable cabin','checkpoint']],
      ['Factory', ['factory','pumping station','emergency exit']],
      ['Woods', ['woods','sawmill','zb-014','usec camp','shturman']],
      ['Reserve', ['reserve','rb-','black pawn','white pawn','black knight','white knight','king building','queen building','bishop','bunker']],
      ['Interchange', ['interchange','kiba','ultra','oli','goshan','idea','emercom','power substation','object #']],
      ['The Labyrinth', ['labyrinth','spawn chamber']],
      ['The Lab', ['the lab','laboratory','terragroup labs','terra group labs','labs','keycard','parking gate','hangar gate','weapon testing']],
      ['Lighthouse', ['lighthouse','water treatment','rogue','merin','hillside','cottage','usec stash','conference room','operating room']],
      ['Ground Zero', ['ground zero','terragroup science office','science office','fusion','unity credit bank','emergency services academy']],
      ['Terminal', ['terminal']],
      ['Icebreaker', ['icebreaker']]
    ];
    for (const [map, aliases] of localAliases) if (aliases.some(a => hay.includes(a))) return map;
    try { return (typeof inferMapFromText === 'function') ? inferMapFromText(text) : ''; } catch { return ''; }
  }

  async function fetchCategoryKeyTitles(){
    let cmcontinue = '';
    const titles = [];
    do {
      const params = new URLSearchParams({
        action: 'query', list: 'categorymembers', cmtitle: CATEGORY_TITLE,
        cmnamespace: '0', cmlimit: '500', format: 'json', origin: '*'
      });
      if (cmcontinue) params.set('cmcontinue', cmcontinue);
      const res = await fetch(`${CATEGORY_API}?${params.toString()}`);
      if (!res.ok) throw new Error(`Category:Keys ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.info || json.error.code || 'Category:Keys error');
      (json?.query?.categorymembers || []).forEach(p => { if (p?.title) titles.push(p.title); });
      cmcontinue = json?.continue?.cmcontinue || '';
    } while (cmcontinue);
    return [...new Set(titles)].sort((a,b) => a.localeCompare(b));
  }

  async function ensureCategoryTitles(force = false){
    ensureKeyState();
    if (!force && categoryTitles().length) return categoryTitles();
    setStatus('Pulling key page list from wiki Category:Keys...');
    const titles = await fetchCategoryKeyTitles();
    state.keyWikiCategory = { titles, syncedAt: new Date().toISOString(), source: CATEGORY_TITLE };
    mergeCategoryKeysIntoCache(titles);
    persist(true);
    return titles;
  }

  function mergeCategoryKeysIntoCache(titles){
    ensureKeyState();
    const byId = new Map((state.apiCache.keys || []).map(k => [kid(k.name), k]));
    for (const title of titles) {
      const name = String(title || '').replace(/_/g, ' ');
      const id = kid(name);
      if (!id) continue;
      const wikiLink = wikiLinkForTitle(title);
      if (byId.has(id)) {
        const old = byId.get(id);
        old.wikiLink = old.wikiLink || wikiLink;
      } else {
        const item = { name, shortName: '', description: 'Key page from Tarkov Wiki Category:Keys', maps: [], map: '', location: '', wikiLink, source: 'wiki Category:Keys' };
        state.apiCache.keys.push(item);
        byId.set(id, item);
      }
    }
  }

  async function fetchWikiSourceByTitle(title){
    const params = new URLSearchParams({
      action: 'query', prop: 'revisions', titles: String(title || '').replace(/ /g, '_'),
      rvprop: 'content', rvslots: 'main', format: 'json', redirects: '1', origin: '*'
    });
    const res = await fetch(`${CATEGORY_API}?${params.toString()}`);
    if (!res.ok) throw new Error(`wiki source ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.info || json.error.code || 'wiki source error');
    const page = Object.values(json?.query?.pages || {})[0] || {};
    if (String(page.missing) === '') throw new Error(`wiki page missing: ${title}`);
    const rev = (page.revisions || [])[0] || {};
    const wiki = rev?.slots?.main?.['*'] || rev?.['*'] || '';
    if (!wiki) throw new Error(`wiki source empty: ${title}`);
    return { title: page.title || title, wiki };
  }

  async function fetchWikiIntelByResolvedTitle(key){
    await ensureCategoryTitles(false).catch(() => categoryTitles());
    const resolvedTitle = resolveWikiTitleFromCategory(key);
    const { title, wiki } = await fetchWikiSourceByTitle(resolvedTitle);
    const lockLocation = sectionFromWikitext(wiki, ['Lock Location','Lock location','Usage']);
    const keyLocation = sectionFromWikitext(wiki, ['Key Location','Key location','Location']);
    const behindLock = sectionFromWikitext(wiki, ['Behind the Lock','Behind the lock','Behind Lock','Loot']);
    const notes = sectionFromWikitext(wiki, ['Notes','Description']);
    const map = v22InferMap([lockLocation, keyLocation, behindLock, notes, title, key?.name].join(' '));
    return {
      lockLocation: lockLocation || '',
      keyLocation: keyLocation || '',
      behindLock: behindLock || '',
      map: map || '',
      wikiTitle: title,
      wikiLink: wikiLinkForTitle(title),
      source: CATEGORY_TITLE
    };
  }

  function shouldReplaceLocation(oldText, newText){
    const old = safeText(oldText).toLowerCase();
    const n = safeText(newText);
    if (!n) return false;
    if (!old) return true;
    if (typeof isGenericKeyLocation === 'function' && isGenericKeyLocation(old)) return true;
    if (old.includes('no lock location')) return true;
    if (old.includes('key synced from tarkov.dev')) return true;
    return false;
  }

  // Replace the wiki title resolver so all lookups prefer the Category:Keys canonical title.
  const oldWikiTitleFromKey = (typeof wikiTitleFromKey === 'function') ? wikiTitleFromKey : null;
  window.wikiTitleFromKey = wikiTitleFromKey = function wikiTitleFromKeyV22(key){
    try {
      const title = resolveWikiTitleFromCategory(key);
      if (title) return String(title).replace(/ /g, '_');
    } catch {}
    return oldWikiTitleFromKey ? oldWikiTitleFromKey(key) : safeText(key?.name).replace(/\s+/g, '_');
  };

  // Replace wiki intel lookup with Category:Keys resolver first, then older fallbacks.
  const oldFetch = (typeof fetchWikiIntelForKey === 'function') ? fetchWikiIntelForKey : null;
  window.fetchWikiIntelForKey = fetchWikiIntelForKey = async function fetchWikiIntelForKeyV22(key){
    try {
      const intel = await fetchWikiIntelByResolvedTitle(key);
      if (intel && (intel.lockLocation || intel.keyLocation || intel.behindLock || intel.map)) return intel;
    } catch (err) {
      console.warn('v22 category key wiki lookup fallback:', err?.message || err);
    }
    if (oldFetch) return oldFetch(key);
    throw new Error('No wiki key lookup available');
  };

  // Merge category titles and cached lock locations into the visible key object.
  const oldMerge = (typeof mergeKeyIntel === 'function') ? mergeKeyIntel : null;
  window.mergeKeyIntel = mergeKeyIntel = function mergeKeyIntelV22(key){
    ensureKeyState();
    const base = oldMerge ? oldMerge(key) : { ...key };
    const id = kid(base?.name || key?.name);
    const intel = state.keyIntel?.[id] || {};
    const title = intel.wikiTitle || resolveWikiTitleFromCategory(base);
    const lock = intel.lockLocation || '';
    const maps = [...new Set([...(base.maps || []), base.map, intel.map, v22InferMap([lock, base.location, base.name].join(' '))].filter(Boolean))];
    return {
      ...base,
      maps,
      map: maps[0] || base.map || '',
      location: shouldReplaceLocation(base.location, lock) ? lock : (base.location || lock || ''),
      keyLocation: intel.keyLocation || base.keyLocation || '',
      behindLock: intel.behindLock || base.behindLock || '',
      wikiLink: intel.wikiLink || base.wikiLink || wikiLinkForTitle(title),
      wikiTitle: title,
      wikiEnrichedAt: intel.enrichedAt || base.wikiEnrichedAt,
      wikiError: intel.error || base.wikiError
    };
  };

  async function enrichKeyBatchV22(keys, label, maxCount = Infinity){
    ensureKeyState();
    await ensureCategoryTitles(false);
    mergeCategoryKeysIntoCache(categoryTitles());
    const batch = keys.slice(0, maxCount);
    let ok = 0, fail = 0;
    for (let i = 0; i < batch.length; i++) {
      const key = batch[i];
      const id = kid(key.name);
      const cached = state.keyIntel[id];
      if (cached?.lockLocation && cached?.map && cached?.wikiTitle) { ok++; continue; }
      setStatus(`${label}: ${i + 1}/${batch.length} — ${key.name}`);
      try {
        const intel = await fetchWikiIntelByResolvedTitle(key);
        state.keyIntel[id] = { ...(state.keyIntel[id] || {}), ...intel, enrichedAt: new Date().toISOString(), error: '' };
        ok++;
      } catch (err) {
        state.keyIntel[id] = { ...(state.keyIntel[id] || {}), error: err.message || String(err), enrichedAt: new Date().toISOString() };
        fail++;
      }
      if (i % 8 === 0) persist(true);
      await delay(CATEGORY_DELAY_MS);
    }
    persist(true);
    setStatus(`${label} complete: ${ok} saved, ${fail} failed. Category cache: ${categoryTitles().length} key pages.`);
    try { if (typeof toast === 'function') toast(`${label} complete.`); } catch {}
    try { if (typeof render === 'function') render(); } catch {}
  }

  window.syncWikiKeyCategoryList = async function(force = true){
    if (categorySyncRunning) return;
    try {
      categorySyncRunning = true;
      const titles = await ensureCategoryTitles(force);
      mergeCategoryKeysIntoCache(titles);
      persist(true);
      setStatus(`Synced ${titles.length} wiki key pages from Category:Keys. Now use lookup/enrich to cache lock locations.`);
      try { if (typeof toast === 'function') toast(`Synced ${titles.length} wiki key pages.`); } catch {}
      try { if (typeof render === 'function') render(); } catch {}
    } catch (err) {
      setStatus(`Category:Keys sync failed: ${err.message || err}`);
      try { if (typeof toast === 'function') toast('Category:Keys sync failed.'); } catch {}
    } finally { categorySyncRunning = false; }
  };

  window.syncAllWikiKeyLocationsFromCategory = async function(){
    if (categorySyncRunning) return;
    if (!confirm('This will pull the key list from Wiki Category:Keys and slowly cache Lock Location / Key Location for every key page. It may take a few minutes. Continue?')) return;
    categorySyncRunning = true;
    try {
      const titles = await ensureCategoryTitles(true);
      mergeCategoryKeysIntoCache(titles);
      const keys = allKnownKeys().filter(k => titles.map(t => kid(t)).includes(kid(k.name)) || k.wikiLink || k.source === 'wiki Category:Keys');
      await enrichKeyBatchV22(keys.length ? keys : titles.map(t => ({ name: t, wikiLink: wikiLinkForTitle(t), source: 'wiki Category:Keys' })), 'Wiki Category:Keys lock lookup');
    } finally { categorySyncRunning = false; }
  };

  window.enrichOneKeyFromWiki = async function(name){
    ensureKeyState();
    const d = document.createElement('textarea'); d.innerHTML = name; const keyName = d.value;
    const key = (typeof allKnownKeys === 'function' ? allKnownKeys() : []).find(k => String(k.name).toLowerCase() === keyName.toLowerCase()) || { name: keyName };
    const id = kid(keyName);
    setStatus(`Checking wiki Category:Keys for ${keyName}...`);
    try {
      const intel = await fetchWikiIntelByResolvedTitle(key);
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), ...intel, enrichedAt: new Date().toISOString(), error: '' };
      persist(true);
      setStatus(`Saved Lock Location for ${keyName}: ${intel.map || 'map unknown'}.`);
      try { if (typeof toast === 'function') toast('Wiki key location saved.'); } catch {}
      try { if (typeof render === 'function') render(); } catch {}
    } catch (err) {
      state.keyIntel[id] = { ...(state.keyIntel[id] || {}), error: err.message || String(err), enrichedAt: new Date().toISOString() };
      persist(true);
      setStatus(`Wiki lookup failed for ${keyName}: ${err.message || err}`);
      try { if (typeof toast === 'function') toast('Wiki lookup failed.'); } catch {}
      try { if (typeof render === 'function') render(); } catch {}
    }
  };

  window.enrichVisibleKeysFromWiki = async function(){
    const keys = (typeof filteredKeysForPage === 'function') ? filteredKeysForPage() : [];
    if (!keys.length) return (typeof toast === 'function' ? toast('No visible keys to enrich.') : null);
    await enrichKeyBatchV22(keys, 'Visible key wiki lookup', 80);
  };
  window.enrichAllKeysFromWiki = async function(){
    if (!confirm('This will slowly check the wiki for every known key and cache Lock Location / Key Location locally. Continue?')) return;
    await enrichKeyBatchV22((typeof allKnownKeys === 'function') ? allKnownKeys() : [], 'All known key wiki lookup', Infinity);
  };

  // Add category-specific controls to the existing key intel panel without touching index.html/styles.css.
  const oldKeyIntelToolsHtml = (typeof keyIntelToolsHtml === 'function') ? keyIntelToolsHtml : null;
  if (oldKeyIntelToolsHtml) {
    window.keyIntelToolsHtml = keyIntelToolsHtml = function keyIntelToolsHtmlV22(filteredCount, totalCount){
      const base = oldKeyIntelToolsHtml(filteredCount, totalCount);
      const titles = categoryTitles().length;
      return String(base).replace('</div>\n    <p id="keyEnrichStatus"', '<button onclick="syncWikiKeyCategoryList(true)">Sync Category:Keys list</button><button class="primary" onclick="syncAllWikiKeyLocationsFromCategory()">Sync all wiki key lock locations</button></div>\n    <p class="meta">Wiki Category:Keys pages cached: '+titles+'</p>\n    <p id="keyEnrichStatus"');
    };
  }

  // Very small auto lookup only when the user has narrowed search down, so searches don't hang.
  function autoLookupFocusedKeySearch(){
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      try {
        const active = document.querySelector('.page.active')?.id;
        if (active !== 'keys' && active !== 'keylocker') return;
        const input = document.getElementById(active === 'keylocker' ? 'lockerSearch' : 'keySearch');
        const q = String(input?.value || '').trim();
        if (q.length < 4) return;
        const keys = active === 'keys' && typeof filteredKeysForPage === 'function' ? filteredKeysForPage() : (typeof allKnownKeys === 'function' ? allKnownKeys().filter(k => String(k.name || '').toLowerCase().includes(q.toLowerCase())) : []);
        if (!keys.length || keys.length > AUTO_LOOKUP_LIMIT) return;
        keys.slice(0, AUTO_LOOKUP_LIMIT).forEach(k => {
          const info = mergeKeyIntel(k);
          if ((!info.location || (typeof isGenericKeyLocation === 'function' && isGenericKeyLocation(info.location)) || !(info.maps || [info.map]).filter(Boolean).length) && !state.keyIntel[kid(info.name)]?.error) {
            window.enrichOneKeyFromWiki(info.name);
          }
        });
      } catch (err) { console.warn('v22 focused key auto lookup skipped', err); }
    }, 900);
  }

  const oldRenderKeys = (typeof renderKeys === 'function') ? renderKeys : null;
  if (oldRenderKeys) {
    window.renderKeys = renderKeys = function renderKeysV22(){
      const result = oldRenderKeys();
      autoLookupFocusedKeySearch();
      return result;
    };
  }
  const oldRenderKeyLocker = (typeof renderKeyLocker === 'function') ? renderKeyLocker : null;
  if (oldRenderKeyLocker) {
    window.renderKeyLocker = renderKeyLocker = function renderKeyLockerV22(){
      const result = oldRenderKeyLocker();
      autoLookupFocusedKeySearch();
      return result;
    };
  }

  try {
    ensureKeyState();
    console.info(`${BUILD} loaded. Key lookup now resolves pages from Wiki Category:Keys and reads Lock Location first.`);
  } catch (err) { console.warn('v22 key category init warning', err); }
})();

/* =========================================================
   v25 patch — Flea Market + personal stash tabs
   - Keeps the supplied index.html/styles.css visual design.
   - Adds Flea Prices, Gear Locker, Weapon Rack and Med Cabinet.
   - Uses tarkov.dev as the default free/keyless price source.
   ========================================================= */
(function(){
  'use strict';
  const BUILD = 'v25-market-and-locker-tabs';
  const PAGE_SIZE = 50;
  const $ = id => document.getElementById(id);
  const arr = v => Array.isArray(v) ? v : [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const norm = s => String(s || '').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
  const k = s => norm(s).replace(/\s+/g,'');
  const num = (v,d=0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const pos = (v,d=1) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
  const money = v => { const n = Math.round(num(v,0)); return n ? `${n.toLocaleString()}₽` : '—'; };
  const toastSafe = msg => { try { if (typeof toast === 'function') toast(msg); else console.log(msg); } catch { console.log(msg); } };

  let marketSearchTimer = null;
  const marketCache = { key:'', items:[] };

  function ensure(){
    try { if (typeof ensureStateShape === 'function') ensureStateShape(); } catch {}
    window.state = window.state || {};
    state.apiCache = state.apiCache || {};
    state.apiCache.marketItems = arr(state.apiCache.marketItems);
    state.apiCache.allItems = arr(state.apiCache.allItems);
    state.items = arr(state.items);
    state.tracked = arr(state.tracked);
    state.raidBag = state.raidBag || {};
    state.appPrefs = state.appPrefs || {};
    state.inventory = state.inventory || {};
    state.inventory.gear = arr(state.inventory.gear);
    state.inventory.weapons = arr(state.inventory.weapons);
    state.inventory.meds = arr(state.inventory.meds);
  }

  function saveProgress(){
    ensure();
    try { if (typeof saveUserProgressOnlyV13 === 'function') saveUserProgressOnlyV13(true); else localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (err) { console.warn('v25 save warning', err); }
  }
  function saveAndRender(){ saveProgress(); try { render(); } catch (err) { console.warn('v25 render after save warning', err); } }

  // Extend the IndexedDB compactor so market prices survive refresh without bloating localStorage.
  try {
    const prevCompact = (typeof compactApiCacheForIndexedDBV13 === 'function') ? compactApiCacheForIndexedDBV13 : null;
    if (prevCompact && !compactApiCacheForIndexedDBV13.__v25Market) {
      const compactMarketItem = item => {
        if (!item) return null;
        const out = {
          id: item.id || undefined,
          name: item.name || undefined,
          normalizedName: item.normalizedName || undefined,
          shortName: item.shortName || undefined,
          iconLink: item.iconLink || undefined,
          wikiLink: item.wikiLink || undefined,
          types: arr(item.types).slice(0, 12),
          basePrice: item.basePrice || undefined,
          avg24hPrice: item.avg24hPrice || undefined,
          lastLowPrice: item.lastLowPrice || undefined,
          low24hPrice: item.low24hPrice || undefined,
          high24hPrice: item.high24hPrice || undefined,
          traderSellPrice: item.traderSellPrice || undefined,
          traderSellName: item.traderSellName || undefined,
          width: item.width || undefined,
          height: item.height || undefined,
          updated: item.updated || undefined,
          source: item.source || undefined
        };
        Object.keys(out).forEach(key => (out[key] === undefined || out[key] === null || (Array.isArray(out[key]) && !out[key].length)) && delete out[key]);
        return out.name ? out : null;
      };
      const patched = function compactApiCacheForIndexedDBV25(cache){
        const base = prevCompact(cache || {});
        base.marketItems = arr(cache?.marketItems).map(compactMarketItem).filter(Boolean);
        // Keep price fields in allItems too, so All Items Lookup and Flea Prices share the same data.
        base.allItems = arr(cache?.allItems).map(i => ({
          id: i.id || undefined,
          name: i.name || undefined,
          normalizedName: i.normalizedName || undefined,
          shortName: i.shortName || undefined,
          iconLink: i.iconLink || undefined,
          wikiLink: i.wikiLink || undefined,
          types: arr(i.types).slice(0, 12),
          category: i.category?.name || i.category || undefined,
          avg24hPrice: i.avg24hPrice || undefined,
          lastLowPrice: i.lastLowPrice || undefined,
          low24hPrice: i.low24hPrice || undefined,
          high24hPrice: i.high24hPrice || undefined,
          traderSellPrice: i.traderSellPrice || undefined,
          traderSellName: i.traderSellName || undefined,
          basePrice: i.basePrice || undefined,
          width: i.width || undefined,
          height: i.height || undefined
        })).filter(i => i.name);
        base.source = `${base.source || 'tarkov.dev GraphQL API'} • v25 market data`;
        return base;
      };
      patched.__v25Market = true;
      compactApiCacheForIndexedDBV13 = patched;
    }
  } catch (err) { console.warn('v25 could not patch IndexedDB compactor', err); }

  function tabHtml(page, label, num, icon){
    return `<button class="tab" data-page="${page}" data-num="${num}"><span class="tab-icon">${icon}</span>${label}</button>`;
  }
  const icons = {
    flea:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/><path d="M18 15l2 2 2-4"/></svg>',
    gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l2 5v13H4V8z"/><path d="M8 8h8"/><path d="M8 13h8"/></svg>',
    weapon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h12l4-4h2v3h-2l-3 3H9l-2 4H4l2-4H3z"/><path d="M8 14v3"/></svg>',
    meds:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M12 11v6"/><path d="M9 14h6"/></svg>'
  };

  function attachTabClick(btn){
    if (!btn || btn.__v25Wired) return;
    btn.__v25Wired = true;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const page = document.getElementById(btn.dataset.page);
      if (page) page.classList.add('active');
      try { render(); } catch (err) { console.error('v25 tab render failed', err); }
    });
  }

  function injectUi(){
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('main.content');
    if (!sidebar || !main) return;
    if (!$('flea')) {
      const before = sidebar.querySelector('[data-page="custom"]') || sidebar.querySelector('[data-page="data"]');
      const wrap = document.createElement('div');
      wrap.innerHTML = [
        tabHtml('flea','Flea Prices','13',icons.flea),
        tabHtml('gearlocker','Gear Locker','14',icons.gear),
        tabHtml('weaponrack','Weapon Rack','15',icons.weapon),
        tabHtml('medcabinet','Med Cabinet','16',icons.meds)
      ].join('');
      [...wrap.children].forEach(node => { sidebar.insertBefore(node, before); attachTabClick(node); });
      document.querySelectorAll('.tab').forEach(attachTabClick);
    }
    if (!$('flea')) main.insertAdjacentHTML('beforeend', fleaPageHtml());
    if (!$('gearlocker')) main.insertAdjacentHTML('beforeend', lockerPageHtml('gearlocker','Gear Locker','// Stash / Kit','Track armour, rigs, bags, helmets, headphones, clothing and containers you own.','gear'));
    if (!$('weaponrack')) main.insertAdjacentHTML('beforeend', lockerPageHtml('weaponrack','Weapon Rack','// Armoury','Track guns you own, builds you want to keep, repair state and notes.','weapons'));
    if (!$('medcabinet')) main.insertAdjacentHTML('beforeend', lockerPageHtml('medcabinet','Med Cabinet','// Medical','Track meds, stims, injectors, splints, surgery kits and healing supplies.','meds'));
    wireV25Inputs();
  }

  function fleaPageHtml(){
    return `<section id="flea" class="page">
      <div class="panel hero compact-hero">
        <div><span class="kicker">// Economy</span><h2>Flea Prices</h2><p>Search item prices and value-per-slot while you are in raid. Default source is tarkov.dev because it is free and does not need an API key.</p></div>
        <div class="search-row">
          <input id="marketSearch" placeholder="Search item name, e.g. GPU, CPU fan, filter..." />
          <select id="marketSort"><option value="rps">Best ₽/slot</option><option value="price">Highest price</option><option value="name">Name A-Z</option><option value="updated">Recently updated</option></select>
          <button id="syncMarketBtn" class="primary">Sync prices</button>
        </div>
      </div>
      <div class="panel action-panel">
        <select id="marketSource"><option value="tarkovdev">tarkov.dev free API</option><option value="tarkovmarket">Tarkov Market API key</option><option value="tarkovguru">Tarkov Guru link/manual</option></select>
        <input id="marketApiKey" placeholder="Optional Tarkov Market API key" />
        <input id="marketMinRps" type="number" min="0" step="1000" placeholder="Min ₽/slot filter, e.g. 10000" />
        <button id="marketTopBtn">Show high value</button>
        <button id="marketClearBtn" class="muted-btn">Clear search</button>
      </div>
      <div id="marketSummary" class="panel stat-strip"></div>
      <div id="marketResults" class="stack"></div>
    </section>`;
  }

  function lockerPageHtml(id, title, kicker, desc, kind){
    const typeOptions = kind === 'gear'
      ? ['Armour','Armoured rig','Rig','Backpack','Helmet','Headset','Face cover','Eyewear','Clothing','Container','Other']
      : kind === 'weapons'
        ? ['Assault rifle','SMG','Shotgun','DMR','Sniper','Pistol','Melee','Preset/build','Parts/mods','Other']
        : ['Medkit','Stim','Injector','Painkiller','Bandage','Hemostat','Splint','Surgery kit','Food/Drink medical','Other'];
    return `<section id="${id}" class="page">
      <div class="panel hero compact-hero">
        <div><span class="kicker">${esc(kicker)}</span><h2>${esc(title)}</h2><p>${esc(desc)}</p></div>
        <div class="search-row narrow"><input id="${id}Search" placeholder="Search ${esc(title.toLowerCase())}..." /><select id="${id}Filter"><option value="all">All types</option>${typeOptions.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select></div>
      </div>
      <div class="panel">
        <h2>Add ${esc(title)} item</h2>
        <form id="${id}Form" class="form-grid">
          <input id="${id}Name" placeholder="Item name" required />
          <input id="${id}Qty" type="number" min="1" value="1" required />
          <select id="${id}Type">${typeOptions.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
          <input id="${id}Note" placeholder="Note, status, durability, build name..." />
          <button type="submit" class="primary">Add</button>
        </form>
      </div>
      <div id="${id}Summary" class="panel stat-strip"></div>
      <div id="${id}List" class="stack"></div>
    </section>`;
  }

  function wireV25Inputs(){
    const syncBtn = $('syncMarketBtn');
    if (syncBtn && !syncBtn.__v25) { syncBtn.__v25 = true; syncBtn.addEventListener('click', () => syncMarketPrices(true)); }
    const topBtn = $('marketTopBtn');
    if (topBtn && !topBtn.__v25) { topBtn.__v25 = true; topBtn.addEventListener('click', () => { ensure(); state.appPrefs.marketShowTop = true; state.appPrefs.marketPage = 1; renderFlea(); }); }
    const clearBtn = $('marketClearBtn');
    if (clearBtn && !clearBtn.__v25) { clearBtn.__v25 = true; clearBtn.addEventListener('click', () => { ['marketSearch','marketMinRps'].forEach(id => { const el=$(id); if(el) el.value=''; }); ensure(); state.appPrefs.marketShowTop=false; state.appPrefs.marketPage=1; renderFlea(); }); }
    ['marketSearch','marketSort','marketMinRps','marketSource'].forEach(id => {
      const el = $(id); if (!el || el.__v25) return; el.__v25 = true;
      const event = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(event, () => { clearTimeout(marketSearchTimer); marketSearchTimer = setTimeout(() => { ensure(); state.appPrefs.marketPage = 1; renderFlea(); }, 220); });
    });
    [['gearlocker','gear'],['weaponrack','weapons'],['medcabinet','meds']].forEach(([page,kind]) => wireLocker(page, kind));
  }

  function wireLocker(page, kind){
    const form = $(`${page}Form`);
    if (form && !form.__v25) {
      form.__v25 = true;
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        addLockerItem(kind, {
          name: $(`${page}Name`)?.value,
          qty: $(`${page}Qty`)?.value,
          type: $(`${page}Type`)?.value,
          note: $(`${page}Note`)?.value
        });
        form.reset();
        const q = $(`${page}Qty`); if (q) q.value = 1;
      });
    }
    [`${page}Search`, `${page}Filter`].forEach(id => {
      const el = $(id); if (!el || el.__v25) return; el.__v25 = true;
      el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { clearTimeout(marketSearchTimer); marketSearchTimer = setTimeout(render, 160); });
    });
  }

  function marketPrice(item){
    const flea = num(item?.lastLowPrice || item?.avg24hPrice || 0, 0);
    const trader = num(item?.traderSellPrice || 0, 0);
    const base = num(item?.basePrice || 0, 0);
    return Math.max(flea, trader, base, 0);
  }
  function itemSlots(item){ return Math.max(1, pos(item?.width,1) * pos(item?.height,1)); }
  function valuePerSlot(item){ return Math.round(marketPrice(item) / itemSlots(item)); }
  function itemTypeText(item){ return arr(item?.types).slice(0,3).join(', ') || item?.category || 'item'; }

  function compactMarketItem(item, source='tarkov.dev'){
    if (!item || !item.name) return null;
    let traderSellPrice = 0, traderSellName = '';
    arr(item.sellFor).forEach(s => {
      const name = s?.vendor?.name || s?.vendor?.trader?.name || s?.source || '';
      if (/flea/i.test(name)) return;
      const price = num(s?.priceRUB || s?.price, 0);
      if (price > traderSellPrice) { traderSellPrice = price; traderSellName = name; }
    });
    return {
      id: item.id || item.uid || undefined,
      name: item.name,
      normalizedName: item.normalizedName || undefined,
      shortName: item.shortName || undefined,
      iconLink: item.iconLink || item.icon || item.img || undefined,
      wikiLink: item.wikiLink || item.link || undefined,
      types: arr(item.types || item.tags).slice(0, 16),
      basePrice: item.basePrice || undefined,
      avg24hPrice: item.avg24hPrice || undefined,
      lastLowPrice: item.lastLowPrice || item.price || undefined,
      low24hPrice: item.low24hPrice || undefined,
      high24hPrice: item.high24hPrice || undefined,
      traderSellPrice: traderSellPrice || item.traderPrice || undefined,
      traderSellName: traderSellName || item.traderName || undefined,
      width: item.width || undefined,
      height: item.height || item.slots && item.width ? Math.ceil(item.slots / item.width) : undefined,
      updated: item.updated || undefined,
      source
    };
  }

  function mergeMarketIntoAllItems(items){
    const by = new Map();
    arr(state.apiCache.allItems).forEach(i => by.set(i.id || k(i.name), {...i}));
    items.forEach(m => {
      const key = m.id || k(m.name);
      const old = by.get(key) || {};
      by.set(key, {...old, ...m, types: arr(m.types).length ? m.types : arr(old.types)});
    });
    state.apiCache.allItems = [...by.values()].filter(i => i.name);
  }

  async function syncMarketPrices(manual=false){
    ensure();
    const status = $('marketSummary') || $('syncStatus');
    const source = $('marketSource')?.value || 'tarkovdev';
    if (status) status.innerHTML = `<span class="badge gold">Syncing ${esc(source)} prices...</span>`;
    let items = [];
    try {
      if (source === 'tarkovmarket') {
        const keyVal = String($('marketApiKey')?.value || '').trim();
        if (!keyVal) throw new Error('Tarkov Market needs an API key. Use tarkov.dev for free/keyless sync.');
        const res = await fetch('https://api.tarkov-market.app/api/v1/items/all', { headers: { 'x-api-key': keyVal } });
        if (!res.ok) throw new Error(`Tarkov Market API returned ${res.status}`);
        const json = await res.json();
        items = arr(json).map(i => compactMarketItem(i, 'tarkov-market')).filter(Boolean);
      } else if (source === 'tarkovguru') {
        throw new Error('No stable public Tarkov Guru API is configured in this local app. Use the website link/manual check or sync from tarkov.dev.');
      } else {
        let data;
        try {
          data = await gql(`query LTTMarketItems($lang: LanguageCode) {
            items(lang: $lang) {
              id name normalizedName shortName iconLink wikiLink types
              basePrice avg24hPrice lastLowPrice low24hPrice high24hPrice updated width height
              sellFor { price priceRUB currency vendor { name } }
            }
          }`, { lang:'en' }, { allowPartial:true });
        } catch (err) {
          console.warn('Full market query failed, trying minimal price query', err);
          data = await gql(`query LTTMarketItemsMinimal { items { id name normalizedName shortName iconLink wikiLink types basePrice avg24hPrice lastLowPrice low24hPrice high24hPrice width height } }`, undefined, { allowPartial:true });
        }
        items = arr(data?.items).map(i => compactMarketItem(i, 'tarkov.dev')).filter(Boolean);
      }
      if (!items.length) throw new Error('No market items returned.');
      state.apiCache.marketItems = items;
      mergeMarketIntoAllItems(items);
      state.apiCache.syncedAt = new Date().toISOString();
      state.apiCache.source = `${state.apiCache.source || 'tarkov.dev GraphQL API'} • market prices ${items.length}`;
      try { if (typeof persistReferenceCacheV13 === 'function') await persistReferenceCacheV13(); } catch (err) { console.warn('v25 IDB market save failed', err); }
      saveProgress();
      marketCache.key = '';
      if (manual) toastSafe(`Market prices synced: ${items.length} items.`);
      renderFlea();
    } catch (err) {
      console.error('v25 market sync failed', err);
      if (status) status.innerHTML = `<span class="badge red">Market sync failed</span><span class="pill">${esc(err.message || err)}</span>`;
      toastSafe('Market price sync failed.');
    }
  }
  window.syncMarketPrices = syncMarketPrices;

  const prevSync = (typeof syncTarkovData === 'function') ? syncTarkovData : null;
  if (prevSync && !syncTarkovData.__v25Market) {
    const patchedSync = async function syncTarkovDataV25(){
      if (prevSync) await prevSync();
      try { await syncMarketPrices(false); }
      catch (err) { console.warn('Market price sync skipped/failed', err); }
    };
    patchedSync.__v25Market = true;
    syncTarkovData = patchedSync;
  }

  function allMarketItems(){
    ensure();
    const keyNow = JSON.stringify({m: state.apiCache.marketItems?.length || 0, a: state.apiCache.allItems?.length || 0, s: state.apiCache.syncedAt || ''});
    if (marketCache.key === keyNow && marketCache.items.length) return marketCache.items;
    const by = new Map();
    arr(state.apiCache.allItems).forEach(i => i?.name && by.set(i.id || k(i.name), compactMarketItem(i, i.source || 'all-items-cache')));
    arr(state.apiCache.marketItems).forEach(i => i?.name && by.set(i.id || k(i.name), compactMarketItem(i, i.source || 'market-cache')));
    marketCache.items = [...by.values()].filter(Boolean);
    marketCache.key = keyNow;
    return marketCache.items;
  }

  function renderFlea(){
    ensure(); injectUi(); wireV25Inputs();
    const list = $('marketResults');
    const summary = $('marketSummary');
    if (!list || !summary) return;
    const all = allMarketItems();
    const search = norm($('marketSearch')?.value || '');
    const minRps = num($('marketMinRps')?.value || 0, 0);
    const sort = $('marketSort')?.value || 'rps';
    const showTop = Boolean(state.appPrefs.marketShowTop);
    const priced = all.filter(i => marketPrice(i) > 0);
    const updated = state.apiCache.syncedAt ? new Date(state.apiCache.syncedAt).toLocaleString() : 'not synced yet';
    summary.innerHTML = `<span class="badge gold">${all.length} market records</span><span class="badge green">${priced.length} priced</span><span class="badge cyan">Last sync: ${esc(updated)}</span><span class="badge red">50 rows/page</span>`;
    if (!search && !showTop && !minRps) {
      list.innerHTML = `<div class="panel readable"><h2>Search before rendering prices</h2><p>Type an item name above, or press <strong>Show high value</strong>. This keeps the page fast while the full item database is cached locally.</p><p class="meta">Recommended source: tarkov.dev free API. Tarkov Market support needs your own API key. Tarkov Guru is linked for manual checking because no stable public API is configured here.</p><p><a class="buttonLink small" href="https://tarkov.guru/" target="_blank" rel="noreferrer">Open Tarkov Guru</a> <a class="buttonLink small" href="https://tarkov-market.com/" target="_blank" rel="noreferrer">Open Tarkov Market</a> <a class="buttonLink small" href="https://tarkov.dev/items" target="_blank" rel="noreferrer">Open tarkov.dev Items</a></p></div>`;
      return;
    }
    const parts = search.split(/\s+/).filter(Boolean);
    let results = all.filter(i => {
      const hay = norm(`${i.name || ''} ${i.shortName || ''} ${arr(i.types).join(' ')}`);
      if (parts.length && !parts.every(p => hay.includes(p))) return false;
      if (minRps && valuePerSlot(i) < minRps) return false;
      if (showTop && valuePerSlot(i) < 10000 && !parts.length) return false;
      return true;
    });
    results.sort((a,b) => {
      if (sort === 'price') return marketPrice(b) - marketPrice(a);
      if (sort === 'name') return String(a.name).localeCompare(String(b.name));
      if (sort === 'updated') return String(b.updated || '').localeCompare(String(a.updated || ''));
      return valuePerSlot(b) - valuePerSlot(a);
    });
    const total = results.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    let page = Math.min(Math.max(1, num(state.appPrefs.marketPage || 1, 1)), pages);
    state.appPrefs.marketPage = page;
    const start = (page - 1) * PAGE_SIZE;
    const shown = results.slice(start, start + PAGE_SIZE);
    const nav = `<div class="panel action-panel"><button class="small" onclick="v25MarketPage(1)" ${page<=1?'disabled':''}>First</button><button class="small" onclick="v25MarketPage(${page-1})" ${page<=1?'disabled':''}>Prev</button><span class="pill">Page ${page} / ${pages}</span><span class="pill">Showing ${total ? start+1 : 0}-${Math.min(start+PAGE_SIZE,total)} of ${total}</span><button class="small" onclick="v25MarketPage(${page+1})" ${page>=pages?'disabled':''}>Next</button><button class="small" onclick="v25MarketPage(${pages})" ${page>=pages?'disabled':''}>Last</button></div>`;
    const rows = shown.map(i => {
      const encoded = encodeURIComponent(i.name || '');
      const slots = itemSlots(i);
      return `<tr><td><strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.shortName || itemTypeText(i))}${i.shortName ? ` • ${esc(itemTypeText(i))}` : ''}</span></td><td>${money(marketPrice(i))}</td><td>${slots}</td><td><strong>${money(valuePerSlot(i))}</strong></td><td>${money(i.avg24hPrice)}</td><td>${money(i.lastLowPrice)}</td><td>${money(i.traderSellPrice)}${i.traderSellName ? `<br><span class="meta">${esc(i.traderSellName)}</span>` : ''}</td><td class="card-actions"><button class="small primary" onclick="v25TrackMarketItem('${encoded}')">Track 1</button><button class="small" onclick="v25RaidBagMarketItem('${encoded}')">Raid +1</button>${i.wikiLink ? ` <a class="buttonLink small" target="_blank" rel="noreferrer" href="${esc(i.wikiLink)}">Wiki</a>` : ''}</td></tr>`;
    }).join('');
    list.innerHTML = total ? `${nav}<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:980px;"><thead><tr><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Best value</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Slots</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">₽ / slot</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">24h avg</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Last low</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Trader</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${rows}</tbody></table></div>${nav}` : `<div class="panel"><h2>No market results</h2><p>Try another search or sync prices first.</p></div>`;
  }

  window.v25MarketPage = function(page){ ensure(); state.appPrefs.marketPage = Math.max(1, num(page,1)); renderFlea(); };
  window.v25TrackMarketItem = function(encoded){
    const name = decodeURIComponent(encoded || '');
    addTrackedMarketItem(name, false);
  };
  window.v25RaidBagMarketItem = function(encoded){
    const name = decodeURIComponent(encoded || '');
    addTrackedMarketItem(name, true);
  };
  function addTrackedMarketItem(name, alsoRaid){
    ensure();
    let item = state.items.find(i => k(i.name) === k(name) && String(i.note || '').includes('Flea Prices'));
    if (!item) { item = { id: crypto.randomUUID(), name, needed: 1, found: 0, source: 'custom', note: 'Added from Flea Prices' }; state.items.push(item); }
    if (!state.tracked.includes(item.id)) state.tracked.push(item.id);
    if (alsoRaid) state.raidBag[item.id] = num(state.raidBag[item.id],0) + 1;
    saveAndRender();
    toastSafe(`${alsoRaid ? 'Raid bag +1' : 'Tracking'}: ${name}`);
  }

  function findMarketByName(name){
    const key = k(name);
    return allMarketItems().find(i => k(i.name) === key || k(i.shortName) === key) || allMarketItems().find(i => k(i.name).includes(key) || key.includes(k(i.name)));
  }

  function addLockerItem(kind, raw){
    ensure();
    const name = String(raw.name || '').trim();
    if (!name) return;
    state.inventory[kind].push({ id: crypto.randomUUID(), name, qty: Math.max(1, num(raw.qty, 1)), type: raw.type || 'Other', note: raw.note || '', addedAt: new Date().toISOString() });
    saveAndRender();
    toastSafe(`Added ${name}.`);
  }
  function lockerKindForPage(page){ return page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds'; }
  window.v25LockerAdjust = function(kind, id, delta){ ensure(); const item = state.inventory[kind].find(i => i.id === id); if (!item) return; item.qty = Math.max(0, num(item.qty,0) + num(delta,0)); if (item.qty <= 0) state.inventory[kind] = state.inventory[kind].filter(i => i.id !== id); saveAndRender(); };
  window.v25LockerDelete = function(kind, id){ ensure(); state.inventory[kind] = state.inventory[kind].filter(i => i.id !== id); saveAndRender(); };
  window.v25LockerTrack = function(kind, id){ ensure(); const item = state.inventory[kind].find(i => i.id === id); if (!item) return; let t = state.items.find(x => k(x.name) === k(item.name) && String(x.note || '').includes('Locker')); if (!t) { t = { id: crypto.randomUUID(), name: item.name, needed: 1, found: num(item.qty,1), source: 'custom', note: `Added from ${kind} Locker` }; state.items.push(t); } if (!state.tracked.includes(t.id)) state.tracked.push(t.id); saveAndRender(); toastSafe(`Tracked ${item.name}.`); };

  function renderLocker(page){
    ensure(); injectUi(); wireV25Inputs();
    const kind = lockerKindForPage(page);
    const list = $(`${page}List`), summary = $(`${page}Summary`);
    if (!list || !summary) return;
    const search = norm($(`${page}Search`)?.value || '');
    const filter = $(`${page}Filter`)?.value || 'all';
    let rows = arr(state.inventory[kind]).filter(i => {
      if (filter !== 'all' && i.type !== filter) return false;
      if (!search) return true;
      const hay = norm(`${i.name} ${i.type} ${i.note}`);
      return search.split(/\s+/).filter(Boolean).every(p => hay.includes(p));
    }).sort((a,b)=>String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name)));
    const totalQty = rows.reduce((s,i)=>s + num(i.qty,0),0);
    const totalValue = rows.reduce((s,i)=>s + num(i.qty,0) * marketPrice(findMarketByName(i.name)),0);
    summary.innerHTML = `<span class="badge gold">${rows.length} rows</span><span class="badge green">${totalQty} total items</span><span class="badge cyan">Estimated value ${money(totalValue)}</span><span class="badge red">Saved locally</span>`;
    if (!rows.length) { list.innerHTML = `<div class="panel"><h2>No ${esc(page.replace(/([a-z])([A-Z])/g,'$1 $2'))} items yet</h2><p>Add items using the form above. This is a manual locker, not auto-filled from missions.</p></div>`; return; }
    const htmlRows = rows.map(i => {
      const market = findMarketByName(i.name);
      const price = marketPrice(market);
      return `<tr><td><strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.note || 'No note')}</span></td><td>${esc(i.type || 'Other')}</td><td>${esc(i.qty)}</td><td>${money(price)}</td><td>${money(price * num(i.qty,0))}</td><td class="card-actions"><button class="small" onclick="v25LockerAdjust('${kind}','${esc(i.id)}',-1)">-</button><button class="small" onclick="v25LockerAdjust('${kind}','${esc(i.id)}',1)">+</button><button class="small primary" onclick="v25LockerTrack('${kind}','${esc(i.id)}')">Track</button><button class="small danger" onclick="v25LockerDelete('${kind}','${esc(i.id)}')">Delete</button></td></tr>`;
    }).join('');
    list.innerHTML = `<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%; border-collapse:collapse; min-width:820px;"><thead><tr><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Item</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Type</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Qty</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Each est.</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Total est.</th><th style="text-align:left; padding:10px; border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${htmlRows}</tbody></table></div>`;
  }

  const baseRender = (typeof render === 'function') ? render : null;
  render = function renderV25(){
    ensure();
    injectUi();
    const active = document.querySelector('.page.active')?.id || 'dashboard';
    if (active === 'flea') return renderFlea();
    if (active === 'gearlocker' || active === 'weaponrack' || active === 'medcabinet') return renderLocker(active);
    if (baseRender) return baseRender();
  };

  try {
    ensure();
    injectUi();
    wireV25Inputs();
    render();
    console.info(`${BUILD} loaded: Flea Prices, Gear Locker, Weapon Rack and Med Cabinet are active.`);
  } catch (err) { console.warn('v25 init warning', err); }
})();

/* =========================================================
   v26 — GitHub cleanup + catalogue lockers
   - One Keys tab only (Key Locker becomes Keys / Locker)
   - Flea Prices is moved to #02 in sidebar
   - Gear/Weapon/Meds use real synced item catalogue + icons
   - Weapon Rack supports saved gun builds / attachment notes
   ========================================================= */
(function(){
  const BUILD = 'v26-catalogue-lockers';
  const PAGE_SIZE = 50;
  let v26Timer = null;

  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const qa = sel => Array.from(document.querySelectorAll(sel));
  const arr = v => Array.isArray(v) ? v : [];
  const num = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
  const esc = s => (typeof escapeHtml === 'function') ? escapeHtml(String(s ?? '')) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const norm = s => String(s || '').trim().toLowerCase();
  const money = v => num(v,0) > 0 ? '₽' + Math.round(num(v,0)).toLocaleString() : '-';

  const categoryLinks = {
    gear: [
      ['Headsets','https://tarkov.dev/items/headsets'], ['Helmets','https://tarkov.dev/items/helmets'],
      ['Glasses','https://tarkov.dev/items/glasses'], ['Armors','https://tarkov.dev/items/armors'],
      ['Rigs','https://tarkov.dev/items/rigs'], ['Backpacks','https://tarkov.dev/items/backpacks'],
      ['Containers','https://tarkov.dev/items/containers']
    ],
    weapons: [
      ['Guns','https://tarkov.dev/items/guns'], ['Suppressors','https://tarkov.dev/items/suppressors'],
      ['Pistol grips','https://tarkov.dev/items/pistol-grips'], ['Mods','https://tarkov.dev/items/mods'],
      ['Grenades','https://tarkov.dev/items/grenades']
    ],
    meds: [
      ['Medical','https://tarkov.dev/items/meds'], ['Provisions','https://tarkov.dev/items/provisions']
    ],
    other: [
      ['Barter items','https://tarkov.dev/items/barter-items'], ['Keys','https://tarkov.dev/items/keys']
    ]
  };

  const gearCats = ['All gear','Headsets','Helmets','Glasses','Armors','Rigs','Backpacks','Containers'];
  const weaponCats = ['All weapon items','Guns','Suppressors','Pistol grips','Mods','Grenades'];
  const medCats = ['All meds/food','Meds','Stims','Injectors','Painkillers','Surgery kits','Splints','Provisions'];

  function ensureState(){
    if (typeof state !== 'object' || !state) return;
    state.apiCache = state.apiCache || {};
    state.apiCache.allItems = arr(state.apiCache.allItems);
    state.apiCache.marketItems = arr(state.apiCache.marketItems);
    state.inventory = state.inventory || {};
    state.inventory.gear = arr(state.inventory.gear);
    state.inventory.weapons = arr(state.inventory.weapons);
    state.inventory.meds = arr(state.inventory.meds);
    state.appPrefs = state.appPrefs || {};
    state.appPrefs.v26 = state.appPrefs.v26 || { gearPage:1, weaponsPage:1, medsPage:1 };
  }

  function saveNow(){
    try { if (typeof safePersistState === 'function') safePersistState(true); else if (typeof saveState === 'function') saveState(); }
    catch(err){ console.warn('v26 save warning', err); }
  }
  function toast(msg){ try { if (typeof toastSafe === 'function') toastSafe(msg); else if (typeof window.toast === 'function') window.toast(msg); } catch {} }

  function reorderSidebar(){
    const sidebar = q('.sidebar'); if (!sidebar) return;

    // One key tab only. The old Keys tab and page are redundant with the richer Key Locker tab.
    const oldKeyTab = sidebar.querySelector('.tab[data-page="keys"]');
    if (oldKeyTab) oldKeyTab.remove();
    const oldKeyPage = $('keys');
    if (oldKeyPage) oldKeyPage.classList.remove('active');
    const keyLockerTab = sidebar.querySelector('.tab[data-page="keylocker"]');
    if (keyLockerTab) setTabText(keyLockerTab, 'Keys / Locker');
    const keyTitle = q('#keylocker h2');
    if (keyTitle && /key locker/i.test(keyTitle.textContent)) keyTitle.textContent = 'Keys / Locker';

    const order = ['dashboard','flea','needed','allitems','raid','maps','keylocker','hideout','tasks','story','gearlocker','weaponrack','medcabinet','custom','data','about'];
    const foot = sidebar.querySelector('.sidebar-foot');
    let anchor = foot || null;
    [...order].reverse().forEach(page => {
      const tab = sidebar.querySelector(`.tab[data-page="${page}"]`);
      if (tab) sidebar.insertBefore(tab, anchor);
      anchor = tab || anchor;
    });
    order.forEach((page, idx) => {
      const tab = sidebar.querySelector(`.tab[data-page="${page}"]`);
      if (tab) tab.dataset.num = String(idx + 1).padStart(2, '0');
    });
    const build = q('.sidebar-foot .foot-row:last-child b');
    if (build) build.textContent = 'v26.0';
  }

  function setTabText(tab, text){
    const nodes = Array.from(tab.childNodes);
    const textNode = nodes.find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (textNode) textNode.textContent = text;
    else tab.appendChild(document.createTextNode(text));
  }

  function typeString(item){ return arr(item?.types).join(' ').toLowerCase(); }
  function hay(item){ return `${item?.name || ''} ${item?.shortName || ''} ${item?.normalizedName || ''} ${typeString(item)}`.toLowerCase(); }
  function hasAny(text, words){ return words.some(w => text.includes(w)); }
  function bestPrice(item){
    return Math.max(num(item?.lastLowPrice,0), num(item?.avg24hPrice,0), num(item?.traderSellPrice,0), num(item?.basePrice,0), 0);
  }
  function itemSlots(item){ return Math.max(1, num(item?.width,1) * num(item?.height,1)); }

  function compactItem(item, source='tarkov.dev'){
    if (!item || !item.name) return null;
    let traderSellPrice = 0, traderSellName = '';
    arr(item.sellFor).forEach(s => {
      const vendor = s?.vendor?.name || s?.vendor?.trader?.name || s?.source || '';
      if (/flea/i.test(vendor)) return;
      const price = num(s?.priceRUB || s?.price,0);
      if (price > traderSellPrice) { traderSellPrice = price; traderSellName = vendor; }
    });
    return {
      id:item.id || item.uid || slug(item.name),
      name:item.name,
      normalizedName:item.normalizedName || undefined,
      shortName:item.shortName || undefined,
      iconLink:item.iconLink || item.icon || item.img || undefined,
      wikiLink:item.wikiLink || item.link || undefined,
      types:arr(item.types || item.tags).slice(0,20),
      basePrice:item.basePrice || undefined,
      avg24hPrice:item.avg24hPrice || undefined,
      lastLowPrice:item.lastLowPrice || item.price || undefined,
      low24hPrice:item.low24hPrice || undefined,
      high24hPrice:item.high24hPrice || undefined,
      traderSellPrice:traderSellPrice || item.traderPrice || undefined,
      traderSellName:traderSellName || item.traderName || undefined,
      width:item.width || undefined,
      height:item.height || undefined,
      source
    };
  }

  function allCatalogue(){
    ensureState();
    const by = new Map();
    arr(state.apiCache.allItems).forEach(i => { const c = compactItem(i, i.source || 'all-items'); if (c?.name) by.set(c.id || slug(c.name), c); });
    arr(state.apiCache.marketItems).forEach(i => { const c = compactItem(i, i.source || 'market'); if (!c?.name) return; const key = c.id || slug(c.name); by.set(key, {...(by.get(key)||{}), ...c, types:arr(c.types).length ? c.types : arr(by.get(key)?.types)}); });
    // Keys may arrive through a separate key cache; include them for matching but the Key Locker owns key tracking.
    arr(state.apiCache.keys).forEach(i => { const c = compactItem({...i, types:['keys']}, 'keys'); if (c?.name) by.set(c.id || slug(c.name), {...(by.get(c.id || slug(c.name))||{}), ...c}); });
    return [...by.values()].filter(i => i.name);
  }

  function itemClass(item){
    const t = hay(item);
    if (hasAny(t, ['headsets','headset','headphones','helmet','face cover','glasses','eyewear','armor','armour','body armor','bodyarmor','plate carrier','tactical rig','chest rig','rigs','backpack','container','case','secure container'])) return 'gear';
    if (hasAny(t, ['guns','gun','weapon','assault rifle','smg','shotgun','pistol','marksman rifle','sniper rifle','machine gun','grenade','suppressor','silencer','pistol grip','foregrip','handguard','barrel','muzzle','scope','sight','optic','magazine','mount','stock','receiver','charging handle','gas block','tactical device','flashlight','laser','mods','mod'])) return 'weapons';
    if (hasAny(t, ['meds','medical','medkit','stim','injector','painkiller','analgesic','bandage','hemostat','tourniquet','splint','surgery','cms','surv12','food','drink','provisions','water','juice','ration','mre'])) return 'meds';
    return 'other';
  }

  function matchesSubCategory(item, cat){
    if (!cat || /^all/i.test(cat)) return true;
    const t = hay(item);
    const c = cat.toLowerCase();
    const map = {
      'headsets':['headsets','headset','headphones','earpiece'],
      'helmets':['helmet'],
      'glasses':['glasses','eyewear'],
      'armors':['armor','armour','body armor','bodyarmor','plate carrier'],
      'rigs':['tactical rig','chest rig','rigs','rig'],
      'backpacks':['backpack'],
      'containers':['container','case','secure container'],
      'guns':['guns','gun','weapon','assault rifle','smg','shotgun','pistol','marksman rifle','sniper rifle','machine gun','grenade launcher'],
      'suppressors':['suppressor','silencer'],
      'pistol grips':['pistol grip'],
      'mods':['mod','mods','scope','sight','optic','foregrip','handguard','barrel','muzzle','magazine','mount','stock','receiver','charging handle','gas block','tactical device','flashlight','laser'],
      'grenades':['grenade'],
      'meds':['meds','medical','medkit','bandage','hemostat','tourniquet'],
      'stims':['stim'],
      'injectors':['injector'],
      'painkillers':['painkiller','analgesic'],
      'surgery kits':['surgery','cms','surv12'],
      'splints':['splint'],
      'provisions':['food','drink','provisions','water','juice','ration','mre','can of','pack of']
    };
    return hasAny(t, map[c] || [c]);
  }

  function catalogueForKind(kind){
    return allCatalogue().filter(i => itemClass(i) === kind || (kind === 'weapons' && itemClass(i) === 'weapons'));
  }

  async function syncItemCatalogueV26(manual=false){
    ensureState();
    const status = $('syncStatus') || $('marketSummary') || q('.panel');
    if (status && status.id === 'syncStatus') status.innerHTML = '<span class="badge gold">Syncing tarkov.dev item catalogue...</span>';
    try {
      const data = await gql(`query LTTItemCatalogueV26($lang: LanguageCode) {
        items(lang: $lang) {
          id name normalizedName shortName iconLink wikiLink types
          basePrice avg24hPrice lastLowPrice low24hPrice high24hPrice updated width height
          sellFor { price priceRUB currency vendor { name } }
        }
      }`, { lang:'en' }, { allowPartial:true });
      const items = arr(data?.items).map(i => compactItem(i, 'tarkov.dev')).filter(Boolean);
      if (!items.length) throw new Error('No items returned from tarkov.dev.');
      const by = new Map();
      arr(state.apiCache.allItems).forEach(i => { if (i?.name) by.set(i.id || slug(i.name), compactItem(i, i.source || 'all-items')); });
      items.forEach(i => by.set(i.id || slug(i.name), {...(by.get(i.id || slug(i.name)) || {}), ...i}));
      state.apiCache.allItems = [...by.values()].filter(Boolean);
      state.apiCache.marketItems = [...by.values()].filter(Boolean);
      state.apiCache.syncedAt = new Date().toISOString();
      state.apiCache.source = `${state.apiCache.source || 'tarkov.dev GraphQL API'} • v26 item catalogue ${items.length}`;
      try { if (typeof persistReferenceCacheV13 === 'function') await persistReferenceCacheV13(); } catch(err){ console.warn('v26 IDB save warning', err); }
      saveNow();
      if (manual) toast(`Item catalogue synced: ${items.length} records.`);
      try { render(); } catch {}
      return items;
    } catch(err){
      console.error('v26 item catalogue sync failed', err);
      if (status && status.id === 'syncStatus') status.innerHTML = `<span class="badge red">Item catalogue sync failed</span><span class="pill">${esc(err.message || err)}</span>`;
      toast('Item catalogue sync failed.');
      return [];
    }
  }
  window.syncItemCatalogueV26 = syncItemCatalogueV26;

  function categorySelectOptions(kind){
    const cats = kind === 'gear' ? gearCats : kind === 'weapons' ? weaponCats : medCats;
    return cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }

  function upgradeLockerPage(page){
    const section = $(page); if (!section || section.dataset.v26Upgraded === '1') return;
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    const title = page === 'gearlocker' ? 'Gear Locker' : page === 'weaponrack' ? 'Weapon Rack' : 'Med Cabinet';
    const kicker = page === 'gearlocker' ? '// Equipment' : page === 'weaponrack' ? '// Armoury' : '// Medical / Provisions';
    const desc = page === 'gearlocker'
      ? 'Add real synced gear items with photos: headsets, helmets, glasses, armour, rigs, backpacks and containers.'
      : page === 'weaponrack'
        ? 'Add real guns, weapon parts and saved gun builds with suppressors, optics, grips, mags and extra mod notes.'
        : 'Add real meds, stims, injectors, surgery kits, splints and provisions.';
    section.dataset.v26Upgraded = '1';
    section.innerHTML = `
      <div class="panel hero compact-hero">
        <div><span class="kicker">${kicker}</span><h2>${title}</h2><p>${desc}</p></div>
        <div class="search-row">
          <input id="${page}Search" placeholder="Search your saved ${title.toLowerCase()}..." />
          <select id="${page}Filter"><option value="all">All saved items</option>${categorySelectOptions(kind).replace(/All [^<]+/,'All')}</select>
          <button id="${page}Sync" class="primary">Sync real items</button>
        </div>
      </div>
      ${page === 'weaponrack' ? weaponBuildPanelHtml() : ''}
      <div class="panel">
        <h2>Add from tarkov.dev item catalogue</h2>
        <p>Search stays hidden until you type or pick a category, keeping the page fast. Icons and prices come from synced tarkov.dev item data.</p>
        <div class="data-grid" style="margin-top:12px">
          <input id="${page}CatalogSearch" placeholder="Search catalogue, e.g. Fast MT, Slick, Salewa, suppressor..." />
          <select id="${page}CatalogCategory">${categorySelectOptions(kind)}</select>
          <button id="${page}CatalogClear" class="muted-btn">Clear</button>
        </div>
        <p class="meta" style="margin-top:10px">Sources: ${sourceLinksHtml(kind)}</p>
        <div id="${page}CatalogSummary" class="stat-strip" style="margin-top:12px"></div>
        <div id="${page}CatalogResults" class="stack"></div>
      </div>
      <div id="${page}Summary" class="panel stat-strip"></div>
      <div id="${page}List" class="stack"></div>`;
    wireV26Locker(page);
  }

  function sourceLinksHtml(kind){
    const links = [...(categoryLinks[kind] || []), ...(kind === 'gear' ? [] : [])];
    return links.map(([label,href]) => `<a class="buttonLink small" href="${href}" target="_blank" rel="noreferrer">${esc(label)}</a>`).join(' ');
  }

  function weaponBuildPanelHtml(){
    return `<div class="panel">
      <h2>Add Weapon Build</h2>
      <p>Save guns the way you have them in-game. The base gun is matched against the synced item catalogue; attachments are stored as build parts/notes.</p>
      <form id="weaponBuildForm" class="form-grid" style="grid-template-columns:1.2fr 1fr 1fr 1fr 90px; align-items:start;">
        <input id="weaponBuildBase" placeholder="Base gun, e.g. M4A1, AK-74N" required />
        <input id="weaponBuildSuppressor" placeholder="Suppressor / muzzle" />
        <input id="weaponBuildOptic" placeholder="Optic / sight" />
        <input id="weaponBuildGrip" placeholder="Grip / foregrip" />
        <input id="weaponBuildQty" type="number" min="1" value="1" />
        <input id="weaponBuildMagazine" placeholder="Magazine" />
        <input id="weaponBuildStock" placeholder="Stock" />
        <input id="weaponBuildTactical" placeholder="Tactical / laser" />
        <input id="weaponBuildExtra" placeholder="Extra mods / ammo / notes" />
        <button type="submit" class="primary">Add build</button>
      </form>
    </div>`;
  }

  function wireV26Locker(page){
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    [`${page}Search`,`${page}Filter`,`${page}CatalogSearch`,`${page}CatalogCategory`].forEach(id => {
      const el = $(id); if (!el || el.__v26) return; el.__v26 = true;
      const event = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(event, () => {
        clearTimeout(v26Timer);
        v26Timer = setTimeout(() => { ensureState(); state.appPrefs.v26[`${kind}Page`] = 1; renderSmartLocker(page); }, 180);
      });
    });
    const sync = $(`${page}Sync`); if (sync && !sync.__v26) { sync.__v26 = true; sync.addEventListener('click', () => syncItemCatalogueV26(true)); }
    const clear = $(`${page}CatalogClear`); if (clear && !clear.__v26) { clear.__v26 = true; clear.addEventListener('click', () => { const s=$(`${page}CatalogSearch`), c=$(`${page}CatalogCategory`); if(s) s.value=''; if(c) c.selectedIndex=0; renderSmartLocker(page); }); }
    const buildForm = $('weaponBuildForm');
    if (page === 'weaponrack' && buildForm && !buildForm.__v26) {
      buildForm.__v26 = true;
      buildForm.addEventListener('submit', ev => {
        ev.preventDefault();
        addWeaponBuild();
        buildForm.reset();
        const q = $('weaponBuildQty'); if (q) q.value = 1;
      });
    }
  }

  function addWeaponBuild(){
    ensureState();
    const baseName = String($('weaponBuildBase')?.value || '').trim();
    if (!baseName) return;
    const match = findCatalogueItem(baseName, 'weapons');
    const build = {
      suppressor: $('weaponBuildSuppressor')?.value || '', optic: $('weaponBuildOptic')?.value || '', grip: $('weaponBuildGrip')?.value || '',
      magazine: $('weaponBuildMagazine')?.value || '', stock: $('weaponBuildStock')?.value || '', tactical: $('weaponBuildTactical')?.value || '', extra: $('weaponBuildExtra')?.value || ''
    };
    state.inventory.weapons.push({
      id: crypto.randomUUID(), name: match?.name || baseName, itemId: match?.id || '', iconLink: match?.iconLink || '', wikiLink: match?.wikiLink || '',
      qty: Math.max(1, num($('weaponBuildQty')?.value,1)), type:'Gun build', note:'Saved weapon build', build, addedAt:new Date().toISOString()
    });
    saveNow(); toast(`Added weapon build: ${match?.name || baseName}`); renderSmartLocker('weaponrack');
  }

  function findCatalogueItem(name, kind){
    const n = norm(name);
    if (!n) return null;
    const list = kind ? catalogueForKind(kind) : allCatalogue();
    return list.find(i => norm(i.name) === n || norm(i.shortName) === n || norm(i.normalizedName) === n)
      || list.find(i => hay(i).includes(n));
  }

  function filteredCatalogue(page){
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    const qv = norm($(`${page}CatalogSearch`)?.value || '');
    const cat = $(`${page}CatalogCategory`)?.value || '';
    let rows = catalogueForKind(kind);
    if (cat && !/^all/i.test(cat)) rows = rows.filter(i => matchesSubCategory(i, cat));
    if (qv) {
      const parts = qv.split(/\s+/).filter(Boolean);
      rows = rows.filter(i => parts.every(p => hay(i).includes(p)));
    } else if (!cat || /^all/i.test(cat)) {
      return [];
    }
    return rows.sort((a,b) => bestPrice(b) - bestPrice(a) || String(a.name).localeCompare(String(b.name)));
  }

  function itemImg(item){
    return item?.iconLink ? `<img src="${esc(item.iconLink)}" alt="" loading="lazy" style="width:42px;height:42px;object-fit:contain;vertical-align:middle;margin-right:10px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:4px;">` : '';
  }

  function renderCatalogueResults(page){
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    const summary = $(`${page}CatalogSummary`), list = $(`${page}CatalogResults`);
    if (!summary || !list) return;
    const all = catalogueForKind(kind);
    const rows = filteredCatalogue(page);
    const prefKey = `${kind}Page`;
    let pageNo = Math.max(1, num(state.appPrefs.v26[prefKey],1));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    pageNo = Math.min(pageNo, pages); state.appPrefs.v26[prefKey] = pageNo;
    summary.innerHTML = `<span class="badge gold">${all.length} synced ${kind} records</span><span class="badge green">${rows.length} result(s)</span><span class="badge cyan">50/page</span><span class="badge red">Icons from synced item data</span>`;
    const searched = norm($(`${page}CatalogSearch`)?.value || '') || !/^all/i.test($(`${page}CatalogCategory`)?.value || '');
    if (!searched) { list.innerHTML = `<div class="empty">Search or choose a category to show real items without rendering the full catalogue.</div>`; return; }
    if (!rows.length) { list.innerHTML = `<div class="empty">No catalogue matches. Try syncing real items or searching a different name.</div>`; return; }
    const nav = `<div class="task-tools"><span>Page ${pageNo} / ${pages}</span><span>${rows.length} results</span><div class="card-actions"><button class="small" onclick="v26LockerCatPage('${page}','1')">First</button><button class="small" onclick="v26LockerCatPage('${page}','${pageNo-1}')">Prev</button><button class="small" onclick="v26LockerCatPage('${page}','${pageNo+1}')">Next</button><button class="small" onclick="v26LockerCatPage('${page}','${pages}')">Last</button></div></div>`;
    const slice = rows.slice((pageNo-1)*PAGE_SIZE, pageNo*PAGE_SIZE);
    const body = slice.map(i => `<tr>
      <td>${itemImg(i)}<strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.shortName || '')}${i.types?.length ? ' • '+esc(arr(i.types).slice(0,3).join(', ')) : ''}</span></td>
      <td>${money(bestPrice(i))}</td><td>${itemSlots(i)}</td><td>${money(Math.round(bestPrice(i)/itemSlots(i)))}</td>
      <td class="card-actions"><button class="small primary" onclick="v26AddCatalogueItem('${page}','${esc(i.id || slug(i.name))}')">Add</button>${i.wikiLink ? ` <a class="buttonLink small" href="${esc(i.wikiLink)}" target="_blank" rel="noreferrer">Wiki</a>`:''}</td>
    </tr>`).join('');
    list.innerHTML = `${nav}<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%;border-collapse:collapse;min-width:820px;"><thead><tr><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Item</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Value</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Slots</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">₽/slot</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${body}</tbody></table></div>${nav}`;
  }

  window.v26LockerCatPage = function(page, p){ ensureState(); const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds'; state.appPrefs.v26[`${kind}Page`] = Math.max(1, num(p,1)); renderSmartLocker(page); };
  window.v26AddCatalogueItem = function(page, itemId){
    ensureState();
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    const item = catalogueForKind(kind).find(i => String(i.id || slug(i.name)) === String(itemId));
    if (!item) return toast('Could not find that item in the synced catalogue.');
    const subType = guessSubType(item, kind);
    const row = { id:crypto.randomUUID(), itemId:item.id || '', name:item.name, iconLink:item.iconLink || '', wikiLink:item.wikiLink || '', qty:1, type:subType, note:'Added from synced tarkov.dev item catalogue', addedAt:new Date().toISOString() };
    if (kind === 'weapons' && subType === 'Gun') row.build = {};
    state.inventory[kind].push(row);
    saveNow(); toast(`Added ${item.name}.`); renderSmartLocker(page);
  };

  function guessSubType(item, kind){
    const cats = kind === 'gear' ? gearCats.slice(1) : kind === 'weapons' ? weaponCats.slice(1) : medCats.slice(1);
    const hit = cats.find(c => matchesSubCategory(item, c));
    if (!hit) return kind === 'gear' ? 'Gear' : kind === 'weapons' ? 'Weapon item' : 'Med / provision';
    if (hit === 'Guns') return 'Gun';
    if (hit === 'Meds') return 'Medical';
    return hit.replace(/s$/,'');
  }

  function renderSmartLocker(page){
    ensureState(); reorderSidebar(); upgradeLockerPage(page); wireV26Locker(page);
    renderCatalogueResults(page);
    const kind = page === 'gearlocker' ? 'gear' : page === 'weaponrack' ? 'weapons' : 'meds';
    const list = $(`${page}List`), summary = $(`${page}Summary`);
    if (!list || !summary) return;
    const search = norm($(`${page}Search`)?.value || '');
    const filter = $(`${page}Filter`)?.value || 'all';
    let rows = arr(state.inventory[kind]).filter(i => {
      if (filter !== 'all' && filter !== 'All' && !String(i.type || '').toLowerCase().includes(String(filter).toLowerCase().replace(/^all\s*/i,''))) return false;
      if (!search) return true;
      const build = i.build ? Object.values(i.build).join(' ') : '';
      return search.split(/\s+/).filter(Boolean).every(p => `${i.name} ${i.type} ${i.note} ${build}`.toLowerCase().includes(p));
    }).sort((a,b)=>String(a.type).localeCompare(String(b.type)) || String(a.name).localeCompare(String(b.name)));
    const totalQty = rows.reduce((s,i)=>s + num(i.qty,0),0);
    const totalValue = rows.reduce((s,i)=>s + num(i.qty,0) * bestPrice(findCatalogueItem(i.name)),0);
    summary.innerHTML = `<span class="badge gold">${rows.length} saved rows</span><span class="badge green">${totalQty} total</span><span class="badge cyan">Estimated ${money(totalValue)}</span><span class="badge red">Saved locally</span>`;
    if (!rows.length) { list.innerHTML = `<div class="empty">No saved items yet. Search the real item catalogue above and press Add.</div>`; return; }
    const body = rows.map(i => {
      const market = findCatalogueItem(i.name);
      const price = bestPrice(market);
      const build = renderBuild(i);
      return `<tr><td>${itemImg(i.iconLink ? i : market)}<strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.note || '')}</span>${build}</td><td>${esc(i.type || 'Other')}</td><td>${esc(i.qty)}</td><td>${money(price)}</td><td>${money(price*num(i.qty,0))}</td><td class="card-actions"><button class="small" onclick="v26LockerAdjust('${kind}','${esc(i.id)}',-1)">-</button><button class="small" onclick="v26LockerAdjust('${kind}','${esc(i.id)}',1)">+</button><button class="small primary" onclick="v26LockerTrack('${kind}','${esc(i.id)}')">Track</button><button class="small danger" onclick="v26LockerDelete('${kind}','${esc(i.id)}')">Delete</button></td></tr>`;
    }).join('');
    list.innerHTML = `<div class="panel" style="overflow:auto;"><table class="all-items-table" style="width:100%;border-collapse:collapse;min-width:900px;"><thead><tr><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Saved item</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Type</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Qty</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Each est.</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Total est.</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--line);">Actions</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function renderBuild(i){
    if (!i?.build || !Object.values(i.build).some(Boolean)) return '';
    const parts = Object.entries(i.build).filter(([,v]) => String(v || '').trim()).map(([k,v]) => `<span class="req-chip">${esc(k)}: ${esc(v)}</span>`).join(' ');
    return `<div class="req-list" style="margin-top:8px">${parts}</div>`;
  }

  window.v26LockerAdjust = function(kind, id, delta){ ensureState(); const it = state.inventory[kind].find(x => x.id === id); if (!it) return; it.qty = Math.max(0, num(it.qty,0)+num(delta,0)); if (it.qty <= 0) state.inventory[kind] = state.inventory[kind].filter(x => x.id !== id); saveNow(); renderSmartLocker(kind === 'gear' ? 'gearlocker' : kind === 'weapons' ? 'weaponrack' : 'medcabinet'); };
  window.v26LockerDelete = function(kind, id){ ensureState(); state.inventory[kind] = state.inventory[kind].filter(x => x.id !== id); saveNow(); renderSmartLocker(kind === 'gear' ? 'gearlocker' : kind === 'weapons' ? 'weaponrack' : 'medcabinet'); };
  window.v26LockerTrack = function(kind, id){ ensureState(); const it = state.inventory[kind].find(x => x.id === id); if (!it) return; let t = state.items.find(x => slug(x.name) === slug(it.name) && String(x.note || '').includes('Locker')); if (!t) { t = { id:crypto.randomUUID(), name:it.name, needed:Math.max(1,num(it.qty,1)), found:Math.max(0,num(it.qty,0)), source:'custom', note:`Added from ${kind} locker` }; state.items.push(t); } if (!state.tracked.includes(t.id)) state.tracked.push(t.id); saveNow(); toast(`Tracked ${it.name}.`); };

  // Add catalogue sync to main sync buttons without replacing existing sync logic.
  function wireSyncButtons(){
    ['syncBtn','syncBtn2'].forEach(id => {
      const btn = $(id); if (!btn || btn.__v26Sync) return; btn.__v26Sync = true;
      btn.addEventListener('click', () => { setTimeout(() => syncItemCatalogueV26(false), 500); }, { passive:true });
    });
  }

  const priorRender = (typeof render === 'function') ? render : null;
  window.render = render = function renderV26(){
    ensureState();
    try { if (priorRender) priorRender(); } catch(err){ console.warn('v26 base render warning', err); }
    reorderSidebar(); wireSyncButtons();
    const active = q('.page.active')?.id || 'dashboard';
    if (['gearlocker','weaponrack','medcabinet'].includes(active)) renderSmartLocker(active);
    if (active === 'keys') {
      const tab = q('.tab[data-page="keylocker"]'); if (tab) tab.click();
    }
  };

  document.addEventListener('DOMContentLoaded', () => { ensureState(); reorderSidebar(); wireSyncButtons(); setTimeout(() => { try { render(); } catch(err){ console.warn('v26 initial render warning', err); } }, 50); });
  try { ensureState(); reorderSidebar(); wireSyncButtons(); console.log('Loaded', BUILD); } catch(err){ console.warn('v26 setup warning', err); }
})();

/* ===== v27 keylocker sync controls fix =====
   The old Keys tab had the wiki key sync buttons. v26 removed the duplicate Keys tab,
   so this moves those controls into the kept Keys / Locker page and makes
   "Enrich visible keys" respect the Key Locker filters/search box.
*/
(function(){
  const BUILD = 'v27-keylocker-sync-controls';

  function lockerFilteredKeysV27(){
    try {
      if (typeof allKnownKeys !== 'function') return [];
      const keys = allKnownKeys();
      const q = (document.getElementById('lockerSearch')?.value || '').toLowerCase();
      const statusFilter = document.getElementById('lockerFilter')?.value || 'all';
      const mf = document.getElementById('lockerMapFilter')?.value || 'all';
      return keys.filter(k0 => {
        const k = (typeof mergeKeyIntel === 'function') ? mergeKeyIntel(k0) : k0;
        const entry = (typeof getLockerEntry === 'function') ? getLockerEntry(k) : {};
        const maps = (k.maps || [k.map, entry.map]).filter(Boolean);
        const text = `${k.name || ''} ${maps.join(' ')} ${k.location || ''} ${k.keyLocation || ''} ${k.behindLock || ''} ${k.description || ''} ${entry.notes || ''}`.toLowerCase();
        const statusOk = statusFilter === 'all'
          || (statusFilter === 'missing' ? entry.status === 'needed' && Number(entry.qty || 0) <= 0
          : statusFilter === 'unused' ? !entry.status || entry.status === 'unused'
          : entry.status === statusFilter);
        return (!q || text.includes(q)) && statusOk && (mf === 'all' || maps.includes(mf));
      });
    } catch (err) {
      console.warn('lockerFilteredKeysV27 failed', err);
      return [];
    }
  }
  window.lockerFilteredKeysV27 = lockerFilteredKeysV27;

  function insertKeyLockerSyncPanelV27(){
    try {
      const summary = document.getElementById('lockerSummary');
      if (!summary || document.getElementById('keyEnrichStatus')) return;
      const keys = (typeof allKnownKeys === 'function') ? allKnownKeys() : [];
      const filtered = lockerFilteredKeysV27();
      let html = '';
      if (typeof keyIntelToolsHtml === 'function') {
        html = keyIntelToolsHtml(filtered.length, keys.length);
      } else {
        const enriched = Object.values(state.keyIntel || {}).filter(v => v?.lockLocation || v?.keyLocation).length;
        html = `<div class="panel action-panel key-intel-panel"><div><strong>Wiki lock-location lookup</strong><p class="meta">Pull Lock Location / Key Location from the Tarkov Wiki and cache it locally.</p></div><div class="card-actions"><button onclick="enrichVisibleKeysFromWiki()">Enrich visible keys from wiki</button><button onclick="enrichAllKeysFromWiki()">Enrich all keys slowly</button><button onclick="syncWikiKeyCategoryList(true)">Sync Category:Keys list</button><button class="primary" onclick="syncAllWikiKeyLocationsFromCategory()">Sync all wiki key lock locations</button></div><p id="keyEnrichStatus" class="meta">Visible: ${filtered.length} / ${keys.length} keys • Wiki enriched cache: ${enriched}</p></div>`;
      }
      summary.insertAdjacentHTML('afterend', html);
    } catch (err) {
      console.warn('insertKeyLockerSyncPanelV27 failed', err);
    }
  }

  const oldRenderKeyLockerV27 = (typeof renderKeyLocker === 'function') ? renderKeyLocker : null;
  if (oldRenderKeyLockerV27) {
    renderKeyLocker = function renderKeyLockerV27(){
      oldRenderKeyLockerV27();
      insertKeyLockerSyncPanelV27();
    };
  }

  const oldEnrichVisibleV27 = window.enrichVisibleKeysFromWiki;
  window.enrichVisibleKeysFromWiki = async function enrichVisibleKeysFromWikiV27(){
    try {
      const active = document.querySelector('.page.active')?.id;
      const keys = active === 'keylocker'
        ? lockerFilteredKeysV27()
        : (typeof filteredKeysForPage === 'function' ? filteredKeysForPage() : []);
      if (!keys.length) {
        if (typeof toast === 'function') toast('No visible keys to enrich.');
        return;
      }
      if (typeof enrichKeyBatchV22 === 'function') return await enrichKeyBatchV22(keys, 'Visible key wiki lookup', 80);
      if (typeof enrichKeyBatch === 'function') return await enrichKeyBatch(keys, 'Visible key wiki lookup', 80);
      if (oldEnrichVisibleV27) return await oldEnrichVisibleV27();
    } catch (err) {
      console.error('Visible key enrichment failed', err);
      if (typeof toast === 'function') toast('Visible key enrichment failed.');
    }
  };

  // Re-render Key Locker if the script loads while that page is already open.
  setTimeout(() => {
    try {
      if (document.querySelector('.page.active')?.id === 'keylocker' && typeof renderKeyLocker === 'function') renderKeyLocker();
    } catch {}
  }, 0);

  console.info(`${BUILD} loaded. Wiki key sync controls now live under Keys / Locker.`);
})();

/* ===== v28 housekeeping: clean key wiki text, raid search, stash inventory ===== */
(function(){
  const BUILD = 'v28-stash-raidbag-key-cleanup';
  const PAGE_SIZE = 50;

  const $v28 = (id) => document.getElementById(id);
  const esc = (str) => String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const n = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const arr = (v) => Array.isArray(v) ? v : [];
  const slug = (str) => String(str || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'item';
  const norm = (str) => String(str || '').toLowerCase().trim();

  function notify(msg){ try { if (typeof toastSafe === 'function') toastSafe(msg); else if (typeof window.toast === 'function') window.toast(msg); } catch {} }
  function persist(noRender=false){
    try {
      state.updatedAt = new Date().toISOString();
      if (typeof safePersistState === 'function') safePersistState(true);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!noRender && typeof render === 'function') render();
    } catch (err) { console.warn('v28 save warning', err); }
  }

  function ensureV28(){
    if (typeof state !== 'object' || !state) return;
    state.raidBag = state.raidBag || {};
    state.raidBagDetails = state.raidBagDetails || {};
    state.stash = state.stash || { items: [] };
    state.stash.items = arr(state.stash.items);
    state.appPrefs = state.appPrefs || {};
    state.appPrefs.v28 = state.appPrefs.v28 || { stashPage:1, raidSearchPage:1 };
  }

  function decodeHtml(s){
    const txt = document.createElement('textarea');
    txt.innerHTML = String(s || '');
    return txt.value;
  }

  function cleanWikiTextV28(input){
    let s = decodeHtml(input || '');
    if (!s) return '';
    s = s
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(li|p|div|td|tr|dd|dt)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{[^{}]*\}\}/g, ' ')
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\[https?:\/\/[^\s\]]+\s*([^\]]*)\]/g, '$1')
      .replace(/File:[^|\n]+\|([^\n]*?)(?=(?:File:|$))/gi, '$1. ')
      .replace(/(?:gallery|\/gallery|mode\s*=\s*packed|widths\s*=\s*"?\d+"?|heights\s*=\s*"?\d+"?)/gi, ' ')
      .replace(/\b(?:alt|link)\s*=\s*[^\s|]+/gi, ' ')
      .replace(/[|]{2,}/g, ' ')
      .replace(/[|]/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    // Trim very long gallery fallout but keep useful text.
    const bits = s.split(/(?=The entrance|The building|Room |Door |Behind|Key spawns|Located|Unlocked|Spawn|On |In )/i)
      .map(x => x.trim()).filter(Boolean);
    if (bits.length > 1) s = bits.slice(0, 4).join(' ');
    return s.length > 520 ? s.slice(0, 520).replace(/\s+\S*$/, '') + '…' : s;
  }
  window.cleanWikiTextV28 = cleanWikiTextV28;

  function compactItemV28(item, source='cache'){
    if (!item || !item.name) return null;
    let traderSellPrice = 0;
    arr(item.sellFor).forEach(s => {
      const vendor = s?.vendor?.name || s?.source || '';
      if (/flea/i.test(vendor)) return;
      const price = n(s?.priceRUB || s?.price, 0);
      if (price > traderSellPrice) traderSellPrice = price;
    });
    return {
      id: item.id || item.uid || slug(item.name),
      name: item.name,
      shortName: item.shortName || '',
      normalizedName: item.normalizedName || '',
      iconLink: item.iconLink || item.icon || item.img || '',
      wikiLink: item.wikiLink || item.link || '',
      types: arr(item.types || item.tags),
      basePrice: n(item.basePrice, 0),
      avg24hPrice: n(item.avg24hPrice, 0),
      lastLowPrice: n(item.lastLowPrice || item.price, 0),
      traderSellPrice: n(item.traderSellPrice || traderSellPrice, 0),
      width: n(item.width, 1),
      height: n(item.height, 1),
      source
    };
  }

  function allCatalogueV28(){
    ensureV28();
    const by = new Map();
    function add(raw, source){
      const item = compactItemV28(raw, source);
      if (!item?.name) return;
      const key = item.id || slug(item.name);
      by.set(key, { ...(by.get(key) || {}), ...item, types: item.types.length ? item.types : arr(by.get(key)?.types) });
    }
    arr(state.apiCache?.allItems).forEach(i => add(i, i.source || 'all-items'));
    arr(state.apiCache?.marketItems).forEach(i => add(i, i.source || 'market'));
    arr(state.apiCache?.keys).forEach(i => add({ ...i, types:['keys'] }, 'keys'));
    arr(state.items).forEach(i => add({ id:i.catalogueId || i.itemId || slug(i.name), name:i.name, shortName:i.shortName, iconLink:i.iconLink, wikiLink:i.wikiLink, types:[i.source || 'tracked'] }, 'tracked'));
    return [...by.values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
  }

  function findCatalogueV28(nameOrId){
    const wanted = norm(nameOrId);
    if (!wanted) return null;
    const items = allCatalogueV28();
    return items.find(i => norm(i.id) === wanted || norm(i.name) === wanted || norm(i.shortName) === wanted || norm(i.normalizedName) === wanted)
      || items.find(i => `${i.name} ${i.shortName} ${i.normalizedName}`.toLowerCase().includes(wanted));
  }

  function itemPriceV28(item){ return Math.max(n(item?.lastLowPrice), n(item?.avg24hPrice), n(item?.traderSellPrice), n(item?.basePrice), 0); }
  function itemImageV28(item){ return item?.iconLink ? `<img src="${esc(item.iconLink)}" alt="" loading="lazy" class="v28-item-icon">` : '<span class="v28-item-icon blank"></span>'; }
  function moneyV28(v){ return n(v,0) ? `${Math.round(n(v,0)).toLocaleString()}₽` : '—'; }

  function stashFindRow(nameOrId){
    ensureV28();
    const key = slug(nameOrId);
    return state.stash.items.find(i => slug(i.name) === key || String(i.itemId || '') === String(nameOrId));
  }

  function addToStashV28(raw, qty=1, opts={}){
    ensureV28();
    const item = typeof raw === 'string' ? (findCatalogueV28(raw) || { name: raw, id: slug(raw) }) : raw;
    if (!item?.name) return null;
    let row = stashFindRow(item.id || item.name) || stashFindRow(item.name);
    if (!row) {
      row = {
        id: crypto.randomUUID(),
        itemId: item.id || slug(item.name),
        name: item.name,
        shortName: item.shortName || '',
        iconLink: item.iconLink || '',
        wikiLink: item.wikiLink || '',
        qty: 0,
        firQty: 0,
        source: opts.source || 'manual',
        note: opts.note || '',
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.stash.items.push(row);
    }
    row.qty = Math.max(0, n(row.qty) + n(qty,1));
    if (opts.fir) row.firQty = Math.max(0, n(row.firQty) + n(qty,1));
    if (item.iconLink && !row.iconLink) row.iconLink = item.iconLink;
    if (item.wikiLink && !row.wikiLink) row.wikiLink = item.wikiLink;
    row.updatedAt = new Date().toISOString();
    return row;
  }
  window.addToStashV28 = addToStashV28;

  function addRaidBagItemV28(raw, qty=1){
    ensureV28();
    const item = typeof raw === 'string' ? (findCatalogueV28(raw) || state.items.find(i => String(i.id) === String(raw)) || { name: raw, id: slug(raw) }) : raw;
    if (!item?.name) return notify('Could not add item to raid bag.');
    const id = item.trackerId || item.id || slug(item.name);
    state.raidBag[id] = Math.max(0, n(state.raidBag[id]) + n(qty,1));
    state.raidBagDetails[id] = {
      id,
      itemId: item.id || item.itemId || '',
      name: item.name,
      shortName: item.shortName || '',
      iconLink: item.iconLink || '',
      wikiLink: item.wikiLink || '',
      source: item.source || 'catalogue',
      addedAt: state.raidBagDetails[id]?.addedAt || new Date().toISOString()
    };
    persist(true);
    renderRaidBagV28();
    try { renderTrackedList(); renderStats(); } catch {}
    notify(`${item.name} added to raid bag.`);
  }
  window.addRaidBagItemV28 = addRaidBagItemV28;

  window.addRaidFound = function addRaidFoundV28(id){
    ensureV28();
    const item = state.items.find(i => String(i.id) === String(id));
    if (!item) return addRaidBagItemV28(id, 1);
    if (!state.tracked.includes(id)) state.tracked.push(id);
    addRaidBagItemV28({ ...item, trackerId:id, id, source:item.source || 'tracked' }, 1);
  };

  window.changeRaidQty = function changeRaidQtyV28(id, delta){
    ensureV28();
    state.raidBag[id] = Math.max(0, n(state.raidBag[id]) + n(delta));
    if (state.raidBag[id] <= 0) { delete state.raidBag[id]; delete state.raidBagDetails[id]; }
    persist(true); renderRaidBagV28(); try { renderTrackedList(); renderStats(); } catch {}
  };
  window.removeFromRaid = function removeFromRaidV28(id){ ensureV28(); delete state.raidBag[id]; delete state.raidBagDetails[id]; persist(true); renderRaidBagV28(); try { renderTrackedList(); renderStats(); } catch {} };

  function safeExtractV28(){
    ensureV28();
    const entries = Object.entries(state.raidBag || {}).filter(([,q]) => n(q) > 0);
    entries.forEach(([id, qty]) => {
      const detail = state.raidBagDetails[id] || {};
      const tracked = state.items.find(i => String(i.id) === String(id));
      if (tracked) tracked.found = Math.min(n(tracked.needed, 0) || (n(tracked.found,0) + n(qty)), n(tracked.found,0) + n(qty));
      const cat = findCatalogueV28(detail.itemId || detail.name || tracked?.name) || detail || tracked;
      if ((cat?.name || tracked?.name)) addToStashV28({ ...cat, name: cat.name || tracked.name }, qty, { source:'raid extract', fir:true });
    });
    state.raidBag = {}; state.raidBagDetails = {};
    persist(true);
    renderRaidBagV28(); renderStashV28(); try { renderTrackedList(); renderStats(); } catch {}
    notify(`Safe extract confirmed. ${entries.length} item line(s) moved to stash and tracked progress.`);
  }
  function lostRaidV28(){ ensureV28(); state.raidBag = {}; state.raidBagDetails = {}; persist(true); renderRaidBagV28(); try { renderTrackedList(); renderStats(); } catch {}; notify('Raid lost. Temporary items cleared.'); }
  window.safeExtract = safeExtractV28;
  window.lostRaid = lostRaidV28;

  function raidSearchRowsV28(){
    const q = norm($v28('raidSearchInput')?.value || '');
    if (!q || q.length < 2) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    return allCatalogueV28().filter(i => terms.every(t => `${i.name} ${i.shortName} ${i.normalizedName} ${arr(i.types).join(' ')}`.toLowerCase().includes(t)))
      .sort((a,b) => itemPriceV28(b) - itemPriceV28(a) || String(a.name).localeCompare(String(b.name)))
      .slice(0, 25);
  }

  function ensureRaidSearchPanel(){
    const raid = $v28('raid');
    if (!raid || $v28('raidSearchPanel')) return;
    const target = raid.querySelector('#raidBag');
    const panel = document.createElement('div');
    panel.id = 'raidSearchPanel';
    panel.className = 'panel';
    panel.innerHTML = `<h2>Add loot to Raid Bag</h2>
      <p>Search synced Tarkov items and add what you found. These will not count until you press Safe Extract.</p>
      <div class="search-row"><input id="raidSearchInput" placeholder="Search item, key, med, barter item..." autocomplete="off"><select id="raidSearchMode"><option value="all">All synced items</option><option value="tracked">Tracked items first</option></select><button id="clearRaidSearchBtn" class="ghost">Clear</button></div>
      <div id="raidSearchResults" class="v28-table-wrap empty">Type at least 2 letters to search.</div>`;
    raid.insertBefore(panel, target);
    $v28('raidSearchInput')?.addEventListener('input', debounceV28(renderRaidSearchV28, 180));
    $v28('raidSearchMode')?.addEventListener('change', renderRaidSearchV28);
    $v28('clearRaidSearchBtn')?.addEventListener('click', () => { const i=$v28('raidSearchInput'); if(i) i.value=''; renderRaidSearchV28(); });
  }

  function renderRaidSearchV28(){
    const el = $v28('raidSearchResults'); if (!el) return;
    let rows = raidSearchRowsV28();
    if ($v28('raidSearchMode')?.value === 'tracked') {
      const trackedNames = new Set(arr(state.tracked).map(id => state.items.find(i => i.id === id)?.name).filter(Boolean).map(slug));
      rows = rows.sort((a,b) => (trackedNames.has(slug(b.name)) - trackedNames.has(slug(a.name))) || itemPriceV28(b)-itemPriceV28(a));
    }
    if (!norm($v28('raidSearchInput')?.value || '')) { el.className='v28-table-wrap empty'; el.textContent='Type at least 2 letters to search.'; return; }
    if (!rows.length) { el.className='v28-table-wrap empty'; el.textContent='No item matches.'; return; }
    el.className = 'v28-table-wrap';
    el.innerHTML = `<table class="v28-table"><thead><tr><th>Item</th><th>Value</th><th>Slots</th><th>₽/slot</th><th>Action</th></tr></thead><tbody>${rows.map(i => {
      const slots = Math.max(1, n(i.width,1) * n(i.height,1));
      const key = esc(i.id || slug(i.name));
      return `<tr><td>${itemImageV28(i)}<strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.shortName || arr(i.types).slice(0,3).join(', '))}</span></td><td>${moneyV28(itemPriceV28(i))}</td><td>${slots}</td><td>${moneyV28(itemPriceV28(i)/slots)}</td><td><button class="small primary" onclick="addRaidBagItemV28('${key}',1)">Add to raid bag</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function getRaidLine(id, qty){
    const detail = state.raidBagDetails?.[id] || {};
    const tracked = state.items.find(i => String(i.id) === String(id));
    const cat = findCatalogueV28(detail.itemId || detail.name || tracked?.name) || {};
    const name = detail.name || tracked?.name || cat.name || 'Unknown item';
    return { id, qty:n(qty), name, iconLink:detail.iconLink || tracked?.iconLink || cat.iconLink || '', price:itemPriceV28(cat), source:tracked ? 'Tracked target' : (detail.source || 'Raid loot'), tracked };
  }

  function renderRaidBagV28(){
    ensureV28(); ensureRaidSearchPanel(); renderRaidSearchV28();
    const el = $v28('raidBag'); if (!el) return;
    const entries = Object.entries(state.raidBag || {}).filter(([,qty]) => n(qty) > 0).map(([id, qty]) => getRaidLine(id, qty));
    if (!entries.length) { el.innerHTML = '<div class="empty">Raid bag empty. Search above and add loot during raid.</div>'; return; }
    const total = entries.reduce((s,i) => s + i.price * i.qty, 0);
    el.innerHTML = `<div class="panel stat-strip"><span class="badge gold">${entries.length} line(s)</span><span class="badge green">${entries.reduce((s,i)=>s+i.qty,0)} total items</span><span class="badge cyan">Estimated ${moneyV28(total)}</span></div>` + entries.map(i => `
      <div class="raid-row">
        <div>${itemImageV28(i)}<strong>${esc(i.name)}</strong><br><span>${esc(i.source)} • Temporary qty: ${i.qty}${i.tracked ? ` • Tracked ${n(i.tracked.found)}/${n(i.tracked.needed)}` : ''}</span></div>
        <div class="card-actions"><button onclick="changeRaidQty('${esc(i.id)}',-1)">-</button><button onclick="changeRaidQty('${esc(i.id)}',1)">+</button><button class="danger" onclick="removeFromRaid('${esc(i.id)}')">Remove</button></div>
      </div>`).join('');
  }

  function stashSearchRowsV28(){
    ensureV28();
    const q = norm($v28('stashAddSearch')?.value || '');
    if (!q || q.length < 2) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    return allCatalogueV28().filter(i => terms.every(t => `${i.name} ${i.shortName} ${i.normalizedName} ${arr(i.types).join(' ')}`.toLowerCase().includes(t))).slice(0, 25);
  }

  function ensureStashPage(){
    const main = document.querySelector('.content'); if (!main || $v28('stash')) return;
    const section = document.createElement('section'); section.id = 'stash'; section.className = 'page';
    section.innerHTML = `<div class="panel hero compact-hero"><div><span class="kicker">// Inventory</span><h2>Stash</h2><p>Everything you have marked as owned or safely extracted. Use this as your in-game stash log.</p></div><div class="search-row"><input id="stashSearch" placeholder="Search stash item, type, note..."><select id="stashFilter"><option value="all">All stash</option><option value="fir">FIR only</option><option value="value">High value first</option></select><button id="stashExportBtn">Export stash CSV</button></div></div>
      <div class="panel"><h2>Add item to stash manually</h2><p>Search synced Tarkov items, then add what you own. Safe extracts also add here automatically.</p><div class="search-row"><input id="stashAddSearch" placeholder="Search item to add..."><input id="stashAddQty" type="number" min="1" value="1"><button id="stashAddClearBtn" class="ghost">Clear</button></div><div id="stashAddResults" class="v28-table-wrap empty">Type at least 2 letters to search.</div></div>
      <div id="stashSummary" class="panel stat-strip"></div><div id="stashList"></div>`;
    const data = $v28('data'); main.insertBefore(section, data || null);
    ['stashSearch','stashFilter'].forEach(id => $v28(id)?.addEventListener('input', debounceV28(renderStashV28, 160)));
    $v28('stashFilter')?.addEventListener('change', renderStashV28);
    $v28('stashAddSearch')?.addEventListener('input', debounceV28(renderStashAddSearchV28, 160));
    $v28('stashAddQty')?.addEventListener('input', renderStashAddSearchV28);
    $v28('stashAddClearBtn')?.addEventListener('click', () => { const i=$v28('stashAddSearch'); if(i)i.value=''; renderStashAddSearchV28(); });
    $v28('stashExportBtn')?.addEventListener('click', exportStashCsvV28);
  }

  function renderStashAddSearchV28(){
    const el = $v28('stashAddResults'); if (!el) return;
    const q = norm($v28('stashAddSearch')?.value || '');
    const rows = stashSearchRowsV28();
    if (!q) { el.className='v28-table-wrap empty'; el.textContent='Type at least 2 letters to search.'; return; }
    if (!rows.length) { el.className='v28-table-wrap empty'; el.textContent='No item matches.'; return; }
    el.className = 'v28-table-wrap';
    const qty = Math.max(1, n($v28('stashAddQty')?.value, 1));
    el.innerHTML = `<table class="v28-table"><thead><tr><th>Item</th><th>Value</th><th>Action</th></tr></thead><tbody>${rows.map(i => `<tr><td>${itemImageV28(i)}<strong>${esc(i.name)}</strong><br><span class="meta">${esc(i.shortName || arr(i.types).slice(0,3).join(', '))}</span></td><td>${moneyV28(itemPriceV28(i))}</td><td><button class="small primary" onclick="v28AddStashById('${esc(i.id || slug(i.name))}',${qty})">Add x${qty}</button></td></tr>`).join('')}</tbody></table>`;
  }

  window.v28AddStashById = function(id, qty=1){
    const item = findCatalogueV28(id) || allCatalogueV28().find(i => String(i.id) === String(id));
    if (!item) return notify('Could not find that item.');
    addToStashV28(item, qty, { source:'manual' }); persist(true); renderStashV28(); renderStashAddSearchV28(); notify(`Added ${item.name} x${qty} to stash.`);
  };
  window.v28StashAdjust = function(id, delta){
    ensureV28(); const row = state.stash.items.find(i => i.id === id); if (!row) return;
    row.qty = Math.max(0, n(row.qty) + n(delta)); if (row.qty <= 0) state.stash.items = state.stash.items.filter(i => i.id !== id); persist(true); renderStashV28();
  };
  window.v28StashFirAdjust = function(id, delta){
    ensureV28(); const row = state.stash.items.find(i => i.id === id); if (!row) return;
    row.firQty = Math.max(0, Math.min(n(row.qty), n(row.firQty) + n(delta))); persist(true); renderStashV28();
  };
  window.v28StashTrack = function(id){
    ensureV28(); const row = state.stash.items.find(i => i.id === id); if (!row) return;
    let item = state.items.find(i => slug(i.name) === slug(row.name) && String(i.note || '').includes('Stash'));
    if (!item) { item = { id:crypto.randomUUID(), name:row.name, needed:Math.max(1,n(row.qty,1)), found:n(row.qty,0), source:'custom', note:'Added from Stash page' }; state.items.push(item); }
    if (!state.tracked.includes(item.id)) state.tracked.push(item.id);
    persist(true); renderStashV28(); notify(`Tracked ${row.name}.`);
  };

  function renderStashV28(){
    ensureV28(); ensureStashPage(); renderStashAddSearchV28();
    const list = $v28('stashList'), summary = $v28('stashSummary'); if (!list || !summary) return;
    const q = norm($v28('stashSearch')?.value || '');
    const filter = $v28('stashFilter')?.value || 'all';
    let rows = arr(state.stash.items).map(r => ({...r, cat:findCatalogueV28(r.itemId || r.name)}));
    if (q) { const terms=q.split(/\s+/).filter(Boolean); rows = rows.filter(r => terms.every(t => `${r.name} ${r.shortName} ${r.note} ${arr(r.cat?.types).join(' ')}`.toLowerCase().includes(t))); }
    if (filter === 'fir') rows = rows.filter(r => n(r.firQty) > 0);
    rows = rows.sort((a,b) => filter === 'value' ? (itemPriceV28(b.cat)*n(b.qty) - itemPriceV28(a.cat)*n(a.qty)) : String(a.name).localeCompare(String(b.name)));
    const qty = rows.reduce((s,r)=>s+n(r.qty),0), value = rows.reduce((s,r)=>s+n(r.qty)*itemPriceV28(r.cat),0), fir = rows.reduce((s,r)=>s+n(r.firQty),0);
    summary.innerHTML = `<span class="badge gold">${rows.length} stash rows</span><span class="badge green">${qty} total items</span><span class="badge cyan">${fir} FIR marked</span><span class="badge red">Estimated ${moneyV28(value)}</span>`;
    if (!rows.length) { list.innerHTML = '<div class="empty">No stash items yet. Add manually above or use the Raid Bag safe extract flow.</div>'; return; }
    let pageNo = Math.max(1, n(state.appPrefs.v28.stashPage,1)); const pages = Math.max(1, Math.ceil(rows.length/PAGE_SIZE)); pageNo = Math.min(pageNo, pages); state.appPrefs.v28.stashPage = pageNo;
    const nav = `<div class="task-tools"><span>Page ${pageNo} / ${pages}</span><span>${rows.length} rows</span><div class="card-actions"><button class="small" onclick="v28StashPage(1)">First</button><button class="small" onclick="v28StashPage(${pageNo-1})">Prev</button><button class="small" onclick="v28StashPage(${pageNo+1})">Next</button><button class="small" onclick="v28StashPage(${pages})">Last</button></div></div>`;
    const slice = rows.slice((pageNo-1)*PAGE_SIZE, pageNo*PAGE_SIZE);
    list.innerHTML = `${nav}<div class="panel v28-table-wrap"><table class="v28-table"><thead><tr><th>Item</th><th>Qty</th><th>FIR</th><th>Each</th><th>Total</th><th>Actions</th></tr></thead><tbody>${slice.map(r => `<tr><td>${itemImageV28(r.iconLink ? r : r.cat)}<strong>${esc(r.name)}</strong><br><span class="meta">${esc(r.note || arr(r.cat?.types).slice(0,3).join(', '))}</span></td><td>${n(r.qty)}</td><td>${n(r.firQty)}</td><td>${moneyV28(itemPriceV28(r.cat))}</td><td>${moneyV28(itemPriceV28(r.cat)*n(r.qty))}</td><td class="card-actions"><button class="small" onclick="v28StashAdjust('${esc(r.id)}',-1)">-</button><button class="small" onclick="v28StashAdjust('${esc(r.id)}',1)">+</button><button class="small" onclick="v28StashFirAdjust('${esc(r.id)}',1)">+FIR</button><button class="small primary" onclick="v28StashTrack('${esc(r.id)}')">Track</button><button class="small danger" onclick="v28StashAdjust('${esc(r.id)}',-${n(r.qty)})">Delete</button></td></tr>`).join('')}</tbody></table></div>${nav}`;
  }
  window.v28StashPage = function(p){ ensureV28(); state.appPrefs.v28.stashPage = Math.max(1,n(p,1)); renderStashV28(); };

  function exportStashCsvV28(){
    ensureV28();
    const lines = [['Name','Qty','FIR Qty','Estimated Each RUB','Estimated Total RUB','Note']];
    arr(state.stash.items).forEach(r => { const cat = findCatalogueV28(r.itemId || r.name); lines.push([r.name,n(r.qty),n(r.firQty),itemPriceV28(cat),itemPriceV28(cat)*n(r.qty),r.note || '']); });
    const csv = lines.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ltt-stash.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  function renderKeyLockerV28(){
    ensureV28();
    const list = $v28('lockerList'); if (!list) return;
    const keys = (typeof allKnownKeys === 'function') ? allKnownKeys() : arr(state.apiCache?.keys);
    const mapFilter = $v28('lockerMapFilter');
    if (mapFilter) {
      const maps = [...new Set(keys.flatMap(k0 => { const k = (typeof mergeKeyIntel === 'function') ? mergeKeyIntel(k0) : k0; return arr(k.maps).concat(k.map).filter(Boolean); }))].sort();
      const old = mapFilter.value || 'all'; mapFilter.innerHTML = '<option value="all">All maps</option>' + maps.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join(''); mapFilter.value = [...mapFilter.options].some(o=>o.value===old) ? old : 'all';
    }
    const q = norm($v28('lockerSearch')?.value || ''), statusFilter = $v28('lockerFilter')?.value || 'all', mf = mapFilter?.value || 'all';
    const entries = keys.map(k0 => { const k = (typeof mergeKeyIntel === 'function') ? mergeKeyIntel(k0) : k0; const e = (typeof getLockerEntry === 'function') ? getLockerEntry(k) : {}; return { key:k, entry:e }; });
    const filtered = entries.filter(({key:k, entry:e}) => {
      const maps = arr(k.maps).concat(k.map, e.map).filter(Boolean);
      const loc = cleanWikiTextV28(k.location || k.lockLocation || '');
      const keyLoc = cleanWikiTextV28(k.keyLocation || '');
      const behind = cleanWikiTextV28(k.behindLock || '');
      const text = `${k.name} ${maps.join(' ')} ${loc} ${keyLoc} ${behind} ${e.notes || ''}`.toLowerCase();
      const statusOk = statusFilter === 'all' || (statusFilter === 'missing' ? e.status === 'needed' && n(e.qty)<=0 : statusFilter === 'unused' ? !e.status || e.status === 'unused' : e.status === statusFilter);
      return (!q || text.includes(q)) && statusOk && (mf === 'all' || maps.includes(mf));
    });
    const owned = entries.filter(e => e.entry.status === 'owned').length;
    const needed = entries.filter(e => e.entry.status === 'needed').length;
    const missing = entries.filter(e => e.entry.status === 'needed' && n(e.entry.qty) <= 0).length;
    const summary = $v28('lockerSummary');
    if (summary) summary.innerHTML = `<div class="stats inline-stats"><div class="stat"><strong>${owned}</strong><span>owned keys</span></div><div class="stat"><strong>${needed}</strong><span>needed keys</span></div><div class="stat"><strong>${missing}</strong><span>still missing</span></div><div class="stat"><strong>${keys.length}</strong><span>known keys</span></div></div>`;
    const syncPanel = keySyncPanelV28(filtered.length, keys.length);
    if (!filtered.length) { list.innerHTML = syncPanel + '<div class="empty">No keys match that filter.</div>'; return; }
    list.innerHTML = syncPanel + `<div class="v28-key-grid">${filtered.map(({key:k, entry:e}) => {
      const maps = [...new Set(arr(k.maps).concat(k.map, e.map).filter(Boolean))];
      const loc = cleanWikiTextV28(k.location || k.lockLocation || 'No lock location cached yet.');
      const keyLoc = cleanWikiTextV28(k.keyLocation || '');
      const behind = cleanWikiTextV28(k.behindLock || '');
      const safe = esc(k.name).replace(/'/g, '&#39;');
      const status = e.status === 'owned' ? `Owned x${e.qty || 1}` : e.status === 'needed' ? 'Needed' : 'Not marked';
      return `<article class="card key-locker-card v28-key-card"><div class="card-head"><div><h3>${esc(k.name)}</h3><p class="meta">${esc(maps.join(', ') || 'Map unknown')}</p></div><span class="pill">${esc(status)}</span></div>
        <p><strong>Lock/use:</strong> ${esc(loc)}</p>${keyLoc ? `<p class="meta"><strong>Key spawns:</strong> ${esc(keyLoc)}</p>` : ''}${behind ? `<p class="meta"><strong>Behind lock:</strong> ${esc(behind)}</p>` : ''}
        <div class="qty-row"><span>Owned qty</span><button onclick="changeKeyQty('${safe}', -1)">-</button><strong>${n(e.qty)}</strong><button onclick="changeKeyQty('${safe}', 1)">+</button></div>
        <textarea rows="2" placeholder="Your note: spawn, use, who has spare keys..." oninput="updateKeyNote('${safe}', this.value)">${esc(e.notes || '')}</textarea>
        <div class="card-actions">${typeof keyStatusButtons === 'function' ? keyStatusButtons(k.name, e) : ''}<button onclick="addKeyToTracker('${safe}')">Track as item</button><button onclick="enrichOneKeyFromWiki('${safe}')">Wiki lookup</button>${k.wikiLink ? `<a class="buttonLink small" target="_blank" rel="noreferrer" href="${esc(k.wikiLink)}">Wiki</a>` : ''}</div></article>`;
    }).join('')}</div>`;
  }

  function keySyncPanelV28(filteredCount, totalCount){
    const enriched = Object.values(state.keyIntel || {}).filter(v => v?.lockLocation || v?.keyLocation).length;
    return `<div class="panel action-panel key-intel-panel"><div><strong>Wiki key sync</strong><p class="meta">Pull clean Lock Location / Key Location / Behind the Lock data from the Tarkov Wiki Category:Keys and cache it locally.</p></div><div class="card-actions"><button onclick="syncWikiKeyCategoryList(true)">Sync Category:Keys list</button><button class="primary" onclick="syncAllWikiKeyLocationsFromCategory()">Sync all wiki key lock locations</button><button onclick="enrichVisibleKeysFromWiki()">Enrich visible keys</button><button onclick="enrichAllKeysFromWiki()">Enrich all keys slowly</button><button class="ghost" onclick="clearWikiKeyIntel()">Clear wiki key cache</button></div><p id="keyEnrichStatus" class="meta">Visible: ${filteredCount} / ${totalCount} keys • Wiki enriched cache: ${enriched}</p></div>`;
  }

  function addSidebarTabV28(){
    const sidebar = document.querySelector('.sidebar'); if (!sidebar) return;
    if (!sidebar.querySelector('[data-page="stash"]')) {
      const btn = document.createElement('button'); btn.className = 'tab'; btn.dataset.page = 'stash'; btn.dataset.num = '05';
      btn.innerHTML = `<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span>Stash`;
      const before = sidebar.querySelector('[data-page="maps"]') || sidebar.querySelector('.sidebar-foot'); sidebar.insertBefore(btn, before);
      btn.addEventListener('click', () => switchPageV28('stash'));
    }
    const order = ['dashboard','flea','needed','allitems','raid','stash','maps','keylocker','hideout','tasks','story','gearlocker','weaponrack','medcabinet','custom','data','about'];
    const foot = sidebar.querySelector('.sidebar-foot'); let anchor = foot || null;
    [...order].reverse().forEach(page => { const tab = sidebar.querySelector(`.tab[data-page="${page}"]`); if (tab) { sidebar.insertBefore(tab, anchor); anchor = tab; } });
    order.forEach((page, idx) => { const tab = sidebar.querySelector(`.tab[data-page="${page}"]`); if (tab) tab.dataset.num = String(idx+1).padStart(2,'0'); });
    const build = document.querySelector('.sidebar-foot .foot-row:last-child b'); if (build) build.textContent = 'v28.0';
    const subtitle = document.querySelector('.topbar-sub'); if (subtitle) subtitle.textContent = 'Offline raid, stash, market & locker tracker // v28';
  }

  function switchPageV28(id){
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === id));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    if (id === 'stash') renderStashV28();
    else if (id === 'raid') renderRaidBagV28();
    else if (id === 'keylocker') renderKeyLockerV28();
    else try { if (typeof render === 'function') render(); } catch {}
  }

  function rewireExtractButtonsV28(){
    ['extractBtn','dashExtractBtn'].forEach(id => replaceButtonHandler(id, safeExtractV28));
    ['deathBtn','dashDeathBtn'].forEach(id => replaceButtonHandler(id, lostRaidV28));
  }
  function replaceButtonHandler(id, handler){
    const btn = $v28(id); if (!btn || btn.__v28Wired) return;
    const clone = btn.cloneNode(true); clone.__v28Wired = true; clone.addEventListener('click', handler); btn.replaceWith(clone);
  }

  function debounceV28(fn, wait){ let timer; return function(...args){ clearTimeout(timer); timer = setTimeout(() => fn.apply(this,args), wait); }; }

  const oldRenderV28 = (typeof render === 'function') ? render : null;
  window.render = render = function renderV28(){
    ensureV28(); ensureStashPage(); addSidebarTabV28();
    try { if (oldRenderV28) oldRenderV28(); } catch (err) { console.warn('v28 base render warning', err); }
    addSidebarTabV28(); rewireExtractButtonsV28();
    const active = document.querySelector('.page.active')?.id;
    if (active === 'raid') renderRaidBagV28();
    if (active === 'stash') renderStashV28();
    if (active === 'keylocker') renderKeyLockerV28();
  };

  try { window.renderKeyLocker = renderKeyLocker = renderKeyLockerV28; } catch {}

  document.addEventListener('DOMContentLoaded', () => {
    ensureV28(); ensureStashPage(); addSidebarTabV28(); rewireExtractButtonsV28();
    $v28('raidSearchInput')?.addEventListener('input', debounceV28(renderRaidSearchV28, 180));
    setTimeout(() => { try { render(); } catch (err) { console.warn('v28 initial render warning', err); } }, 80);
  });

  // Lightweight CSS for new table/icon elements only; does not restyle the user's main theme.
  const css = document.createElement('style');
  css.textContent = `
    .v28-table-wrap{overflow:auto;max-width:100%;}
    .v28-table{width:100%;border-collapse:collapse;min-width:780px;}
    .v28-table th,.v28-table td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle;}
    .v28-item-icon{width:42px;height:42px;object-fit:contain;vertical-align:middle;margin-right:10px;background:rgba(255,255,255,.03);border:1px solid var(--line);border-radius:4px;display:inline-block;}
    .v28-item-icon.blank{background:rgba(255,255,255,.02);}
    .v28-key-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px;}
    .v28-key-card p{white-space:normal;word-break:normal;overflow-wrap:anywhere;}
    .v28-key-card .meta{overflow-wrap:anywhere;}
  `;
  document.head.appendChild(css);

  try { ensureV28(); addSidebarTabV28(); rewireExtractButtonsV28(); console.info(`${BUILD} loaded.`); } catch (err) { console.warn('v28 setup warning', err); }
})();

/* ===== v29 Stash Scanner: OCR short-name matching + review import ===== */
(function(){
  const BUILD = 'v0.3.4-stash-scanner-ocr-label-fix';
  const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const PAGE_ORDER = ['dashboard','flea','stash','stashscanner','raid','needed','allitems','maps','keylocker','hideout','tasks','gearlocker','weaponrack','medcabinet','story','custom','data','about'];
  const esc = (str) => String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const arr = (v) => Array.isArray(v) ? v : [];
  const num = (v, fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const slug = (str) => String(str || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'item';
  const norm = (str) => String(str || '').toLowerCase().replace(/['’]/g,'').replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  const compact = (str) => norm(str).replace(/\s+/g,'');
  const $v29 = (id) => document.getElementById(id);

  function notify(msg){ try { if (typeof toastSafe === 'function') toastSafe(msg); else if (typeof toast === 'function') toast(msg); } catch {} }
  function persist(noRender=true){
    try {
      state.updatedAt = new Date().toISOString();
      if (typeof safePersistState === 'function') safePersistState(true);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (!noRender && typeof render === 'function') render();
    } catch(err){ console.warn('v29 save warning', err); }
  }

  function ensureV29(){
    state.stash = state.stash || { items: [] };
    state.stash.items = arr(state.stash.items);
    state.stashScanner = state.stashScanner || { pending: [], rawText: '', lastScanAt: null, settings: { ignoreDogtags:true, minConfidence:35 } };
    state.stashScanner.pending = arr(state.stashScanner.pending);
    state.appPrefs = state.appPrefs || {};
    state.appPrefs.v29 = state.appPrefs.v29 || { lastImageName:'', showRaw:false, scannerMode:'multi' };
    state.stashScanner.settings.minConfidence = state.stashScanner.settings.minConfidence || 35;
  }

  function compactItem(raw, source='catalogue'){
    if (!raw || !raw.name) return null;
    return {
      id: raw.id || raw.itemId || raw.uid || slug(raw.name),
      name: raw.name,
      shortName: raw.shortName || raw.short || '',
      normalizedName: raw.normalizedName || raw.normalized || '',
      iconLink: raw.iconLink || raw.icon || raw.image || '',
      wikiLink: raw.wikiLink || raw.link || '',
      types: arr(raw.types || raw.tags),
      width: raw.width || 1,
      height: raw.height || 1,
      basePrice: raw.basePrice || 0,
      lastLowPrice: raw.lastLowPrice || raw.price || 0,
      avg24hPrice: raw.avg24hPrice || 0,
      traderSellPrice: raw.traderSellPrice || raw.traderPrice || 0,
      source
    };
  }

  function catalogueV29(){
    const by = new Map();
    function add(raw, source){ const c = compactItem(raw, source); if (!c?.name) return; by.set(c.id || slug(c.name), { ...(by.get(c.id || slug(c.name)) || {}), ...c }); }
    arr(state.apiCache?.allItems).forEach(i => add(i, i.source || 'all-items'));
    arr(state.apiCache?.marketItems).forEach(i => add(i, i.source || 'market'));
    arr(state.apiCache?.keys).forEach(i => add({ ...i, types:['keys'] }, 'keys'));
    arr(state.stash?.items).forEach(i => add({ ...i, types:['stash'] }, 'stash'));
    arr(state.items).forEach(i => add({ id:i.itemId || i.catalogueId || slug(i.name), name:i.name, shortName:i.shortName, iconLink:i.iconLink, wikiLink:i.wikiLink, types:[i.source || 'tracked'] }, 'tracked'));
    return [...by.values()].filter(i => i.name).sort((a,b) => String(a.name).localeCompare(String(b.name)));
  }

  function findCatalogueV29(value){
    const target = norm(value), targetCompact = compact(value);
    if (!target) return null;
    const list = catalogueV29();
    return list.find(i => String(i.id) === String(value))
      || list.find(i => [i.name,i.shortName,i.normalizedName].some(v => norm(v) === target || compact(v) === targetCompact))
      || list.find(i => `${i.name} ${i.shortName} ${i.normalizedName}`.toLowerCase().includes(String(value || '').toLowerCase()));
  }

  function scannerBadAlias(value){
    const c = compact(value);
    const n = norm(value);
    const bad = new Set([
      'key','keys','item','items','part','parts','mod','mods','case','bag','rig','helmet','armor','armour','food','water','gun','guns','rifle','pistol','scope','mag','mags','ammo','round','rounds','stock','tube','map','file',
      'de','pm','gc','qc','om','ii','iii','iv','v','gen','gen1','gen2','gen3','mk1','mk2','mki','mkii','mkiii','l1','l2','l3','x1','x2','x3','and','the','for','with','from','hide','this','tip'
    ]);
    if (!c || c.length < 3) return true;
    if (bad.has(c) || bad.has(n)) return true;
    if (/^\d+$/.test(c)) return true;
    return false;
  }

  function aliasesFor(item){
    const raw = [item.shortName, item.name, item.normalizedName];
    const out = [];
    raw.forEach(v => {
      const clean = norm(v);
      if (clean && !scannerBadAlias(clean)) out.push({ text: clean, compact: compact(clean), kind: v === item.shortName ? 'short' : 'name' });
      const noParen = norm(String(v || '').replace(/\([^)]*\)/g,''));
      if (noParen && noParen !== clean && !scannerBadAlias(noParen)) out.push({ text:noParen, compact:compact(noParen), kind:'name' });
    });
    return out;
  }

  function levenshtein(a,b){
    if (a === b) return 0;
    if (!a) return b.length; if (!b) return a.length;
    const prev = Array.from({length:b.length+1}, (_,i)=>i);
    const cur = Array(b.length+1);
    for (let i=1;i<=a.length;i++){
      cur[0] = i;
      for (let j=1;j<=b.length;j++) cur[j] = Math.min(prev[j]+1, cur[j-1]+1, prev[j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      for (let j=0;j<=b.length;j++) prev[j] = cur[j];
    }
    return prev[b.length];
  }
  function similarity(a,b){
    a = compact(a); b = compact(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const max = Math.max(a.length, b.length);
    return 1 - (levenshtein(a,b) / max);
  }

  function scannerOcrLabelVariants(value){
    // Tarkov labels are tiny. OCR often turns 6/1/Q/I into G/L/0/T.
    // Generate a few safe variants before matching against tarkov.dev shortName/full name.
    const base = norm(value);
    const set = new Set([base]);
    const add = (v) => { v = norm(v); if (v && v.length >= 3 && v.length <= 70) set.add(v); };
    add(base.replace(/\bgenl\b/g, 'gen1'));
    add(base.replace(/\bmki\b/g, 'mk1'));
    add(base.replace(/\bmkii\b/g, 'mk2'));
    add(base.replace(/\bmpx genl\b/g, 'mpx gen1'));
    add(base.replace(/\bpm it\b/g, 'pm ii'));
    add(base.replace(/\bpm lt\b/g, 'pm ii'));
    add(base.replace(/\bbgv 0dit\b/g, 'bgv qdit'));
    add(base.replace(/\bbgv odit\b/g, 'bgv qdit'));
    add(base.replace(/\b0dit\b/g, 'qdit'));
    add(base.replace(/\bodit\b/g, 'qdit'));
    add(base.replace(/\btangogt\b/g, 'tango6t'));
    add(base.replace(/\btango gt\b/g, 'tango6t'));
    // compacted OCR can remove separators; add common no-space repairs too.
    const c = compact(base);
    if (c === 'tangogt') add('tango6t');
    if (c === 'mpxgenl') add('mpx gen1');
    if (c === 'sagmki') add('sag mk1');
    if (c === 'pm it18' || c === 'pmit18' || c === 'pmlt18') add('pm ii 1 8');
    if (c === 'bgv0dit' || c === 'bgvodit') add('bgv qdit');
    return [...set].filter(v => v && !scannerBadAlias(v));
  }

  function scannerMaybeOcrFuzzy(fragment, alias){
    const fc = compact(fragment), ac = compact(alias);
    if (!fc || !ac) return 0;
    let score = similarity(fc, ac);
    scannerOcrLabelVariants(fragment).forEach(v => { score = Math.max(score, similarity(v, ac)); });
    if (fc.length >= 5 && ac.startsWith(fc)) score = Math.max(score, 0.90);
    if (ac.length >= 5 && fc.startsWith(ac)) score = Math.max(score, 0.90);
    return score;
  }

  function buildAliasIndex(){
    const idx = new Map();
    catalogueV29().forEach(item => aliasesFor(item).forEach(a => {
      const list = idx.get(a.compact) || [];
      list.push({ item, alias:a });
      idx.set(a.compact, list);
    }));
    return idx;
  }

  function candidateFragments(text){
    // Conservative text matching. We avoid broad 2-letter/generic fragments such as DE/PM/GEN1
    // because full stash OCR often produces random short tokens that match unrelated items.
    const lines = String(text || '').split(/\n+/).map(l => norm(l)).filter(l => l.length >= 3 && l.length <= 70);
    const tokens = norm(text).split(/\b|\n/).map(t => norm(t)).filter(t => t.length >= 3 && !scannerBadAlias(t) && !/^\d+$/.test(t));
    const out = new Set(lines.filter(l => !scannerBadAlias(l)));
    tokens.forEach((t,i) => {
      out.add(t);
      if (tokens[i+1]) out.add(`${t} ${tokens[i+1]}`);
      if (tokens[i+1] && tokens[i+2]) out.add(`${t} ${tokens[i+1]} ${tokens[i+2]}`);
      if (tokens[i+1] && tokens[i+2] && tokens[i+3]) out.add(`${t} ${tokens[i+1]} ${tokens[i+2]} ${tokens[i+3]}`);
    });
    return [...out].map(norm).filter(v => v.length >= 3 && v.length <= 70 && !scannerBadAlias(v));
  }

  function exactAliasCandidate(fragment, index){
    const variants = scannerOcrLabelVariants(fragment);
    const hits = [];
    variants.forEach(v => {
      const exact = index.get(compact(v));
      if (exact?.length) hits.push(...exact.map(e => ({ ...e, variant:v })));
    });
    if (!hits.length) return null;
    // If the same short label maps to lots of items, it is probably too ambiguous for auto-import.
    const unique = new Map();
    hits.forEach(e => unique.set(e.item.id || e.item.name, e));
    if (unique.size > 3 && compact(fragment).length < 6) return null;
    const list = [...unique.values()];
    list.sort((a,b) =>
      (b.alias.kind === 'short') - (a.alias.kind === 'short') ||
      (compact(a.variant) === compact(fragment) ? -1 : 1) ||
      String(a.item.name).length - String(b.item.name).length
    );
    const chosen = list[0];
    const corrected = compact(chosen.variant) !== compact(fragment);
    return { item: chosen.item, detected:norm(fragment), confidence: corrected ? 94 : (chosen.alias.kind === 'short' ? 96 : 92), method: (corrected ? 'ocr-corrected ' : '') + (chosen.alias.kind === 'short' ? 'short name exact' : 'name exact'), exact:true };
  }

  function bestMatchForFragment(fragment, index, catalogue, opts={}){
    const f = norm(fragment), fc = compact(f);
    if (!fc || fc.length < 3 || scannerBadAlias(f)) return null;
    const exact = exactAliasCandidate(f, index);
    if (exact) return exact;
    if (opts.strictExactOnly) return null;
    let best = null;
    if (fc.length >= 5) {
      catalogue.forEach(item => aliasesFor(item).forEach(a => {
        if (a.compact.length < 5 || a.compact.length > 32) return;
        if (scannerBadAlias(a.text)) return;
        let score = opts.ocrLabel ? scannerMaybeOcrFuzzy(f, a.text) : similarity(fc, a.compact);
        // OCR often drops the final letter, e.g. Powerban -> Powerbank.
        if (a.compact.startsWith(fc) && fc.length >= 6) score = Math.max(score, 0.90);
        if (fc.startsWith(a.compact) && a.compact.length >= 6) score = Math.max(score, 0.90);
        const bonus = a.kind === 'short' ? .03 : 0;
        const final = Math.min(1, score + bonus);
        if (!best || final > best.score) best = { item, detected:f, score:final, confidence: Math.round(final*100), method: a.kind === 'short' ? (opts.ocrLabel ? 'ocr short name fuzzy' : 'short name fuzzy') : (opts.ocrLabel ? 'ocr name fuzzy' : 'name fuzzy') };
      }));
    }
    const threshold = opts.ocrLabel ? 0.86 : (opts.highPrecision ? 0.92 : 0.88);
    // Do not accept fuzzy 3-4 character OCR guesses; they cause most false positives.
    if (opts.ocrLabel && fc.length < 5 && !/\d/.test(fc)) return null;
    return best && best.score >= threshold ? best : null;
  }

  function addScannerMatch(found, match, opts={}){
    if (!match?.item) return;
    const itemName = match.item.name || '';
    if (state.stashScanner.settings.ignoreDogtags && /dogtag|bear dogtag|usec dogtag/i.test(itemName)) return;
    const key = match.item.id || slug(itemName);
    const qty = Math.max(1, num(opts.qty, 1));
    const stackQty = !!opts.stackQty || qty > 1;
    const source = String(opts.qtySource || match.detected || itemName);
    const old = found.get(key);
    const selected = !!match.exact && match.confidence >= 90;
    if (!old) found.set(key, {
      id:key, itemId:match.item.id || key, name:itemName, shortName:match.item.shortName || '', iconLink:match.item.iconLink || '', wikiLink:match.item.wikiLink || '',
      detected:[match.detected], qty: stackQty ? qty : (opts.qty || 1), fir:false, selected, confidence:match.confidence, method:match.method, stackSources: stackQty ? [source] : []
    });
    else {
      const newDetection = !old.detected.includes(match.detected);
      if (newDetection) old.detected.push(match.detected);
      old.confidence = Math.max(old.confidence, match.confidence);
      old.stackSources = arr(old.stackSources);
      if (stackQty && !old.stackSources.includes(source)) {
        old.qty = Math.max(0, num(old.qty,0)) + qty;
        old.stackSources.push(source);
      } else {
        old.qty = Math.max(1, num(old.qty,1), qty);
      }
      old.selected = old.selected || selected;
      if (String(match.method || '').includes('exact')) old.method = match.method;
    }
  }

  function matchScannerText(text, opts={}){
    ensureV29();
    const catalogue = catalogueV29();
    const index = buildAliasIndex();
    const found = new Map();
    candidateFragments(text).forEach(fragment => addScannerMatch(found, bestMatchForFragment(fragment, index, catalogue, { highPrecision:true, strictExactOnly:!!opts.strictExactOnly })));
    const rows = [...found.values()].sort((a,b) => b.confidence - a.confidence || String(a.name).localeCompare(String(b.name))).slice(0, 120);
    state.stashScanner.pending = rows;
    state.stashScanner.rawText = text;
    state.stashScanner.lastScanAt = new Date().toISOString();
    persist(true);
    return rows;
  }

  function wordsFromTesseract(result){
    return arr(result?.data?.words).map(w => {
      const raw = String(w.text || w.symbols?.map(s => s.text).join('') || '').trim();
      const text = norm(raw);
      const bbox = w.bbox || w.boundingBox || {};
      const x0 = num(bbox.x0 ?? bbox.left, 0), y0 = num(bbox.y0 ?? bbox.top, 0);
      const x1 = num(bbox.x1 ?? (bbox.left + bbox.width), x0), y1 = num(bbox.y1 ?? (bbox.top + bbox.height), y0);
      const number = /^\d{1,4}$/.test(raw.replace(/[, .]/g,'')) ? Number(raw.replace(/[, .]/g,'')) : null;
      return { raw, text, number, confidence:num(w.confidence, 0), x0, y0, x1, y1, cx:(x0+x1)/2, cy:(y0+y1)/2 };
    }).filter(w => w.text && w.confidence >= 18 && (/[a-zA-Z]/.test(w.raw || w.text) || Number.isFinite(w.number)));
  }

  function lineGroupsFromWords(words){
    const sorted = [...words].sort((a,b) => a.cy - b.cy || a.x0 - b.x0);
    const lines = [];
    sorted.forEach(w => {
      let line = lines.find(l => Math.abs(l.cy - w.cy) < 18);
      if (!line) { line = { cy:w.cy, words:[] }; lines.push(line); }
      line.words.push(w);
      line.cy = (line.cy * (line.words.length-1) + w.cy) / line.words.length;
    });
    lines.forEach(l => l.words.sort((a,b) => a.x0 - b.x0));
    return lines;
  }

  function scannerFragmentsFromOcr(result){
    const words = wordsFromTesseract(result);
    if (!words.length) return candidateFragments(result?.data?.text || '').map(text => ({ text, exactOnly:false, qty:1, stackQty:false }));
    const out = new Map();
    const maxX = Math.max(1, ...words.map(w => w.x1 || 0));
    const maxY = Math.max(1, ...words.map(w => w.y1 || 0));
    const numberWords = words.filter(w => Number.isFinite(w.number) && w.number > 0 && w.number <= 999);
    const qtyNear = (labelWord) => {
      // Tarkov stack count is usually in the lower-right of the same item tile.
      // This is intentionally conservative and ignores durability like 5/5.
      const dxLimit = Math.max(72, maxX * 0.18);
      const dyLimit = Math.max(42, maxY * 0.22);
      const candidates = numberWords
        .filter(nw => nw.cy > labelWord.cy + 8 && (nw.cy - labelWord.cy) < dyLimit)
        .filter(nw => nw.cx > labelWord.x0 - 12 && nw.cx < labelWord.x0 + dxLimit)
        .sort((a,b) => ((a.cy-labelWord.cy) + Math.abs(a.cx-labelWord.cx)*0.35) - ((b.cy-labelWord.cy) + Math.abs(b.cx-labelWord.cx)*0.35));
      return candidates[0]?.number || 1;
    };
    const add = (text, exactOnly=false, qty=1, stackQty=false, source='') => {
      const t = norm(text).replace(/[|]+/g,' ').trim();
      if (!t || scannerBadAlias(t) || t.length < 3 || t.length > 70) return;
      const key = compact(t) + '|' + (stackQty ? `q${qty}` : 'q1') + '|' + source;
      if (!out.has(key)) out.set(key, { text:t, exactOnly, qty:Math.max(1, num(qty,1)), stackQty:!!stackQty, qtySource: source || t });
    };
    lineGroupsFromWords(words).forEach(line => {
      const clean = line.words.filter(w => /[a-zA-Z]/.test(w.raw || w.text) && !scannerBadAlias(w.text));
      clean.forEach(w => {
        const q = qtyNear(w);
        add(w.text, true, q, q > 1, `${w.text}@${Math.round(w.x0)},${Math.round(w.y0)}:${q}`);
      });
      for (let i=0;i<clean.length;i++){
        for (let n=2;n<=4;n++){
          const part = clean.slice(i,i+n);
          if (part.length !== n) continue;
          const maxGap = Math.max(...part.slice(1).map((w,j) => w.x0 - part[j].x1));
          if (maxGap > Math.max(42, maxX * 0.045)) continue;
          const q = Math.max(...part.map(w => qtyNear(w)));
          add(part.map(w => w.text).join(' '), false, q, q > 1, `${part[0].text}@${Math.round(part[0].x0)},${Math.round(part[0].y0)}:${q}`);
        }
      }
    });
    // Include OCR text lines too, mostly for externally generated OCR or if Tesseract returns label+qty on one line.
    parseExternalItemLines(result?.data?.text || '').forEach(entry => add(entry.label, true, entry.qty, entry.qty > 1, entry.original));
    String(result?.data?.text || '').split(/\n+/).forEach(line => {
      const t = norm(line);
      if (t && t.length <= 70) add(t, true, 1, false, t);
    });
    return [...out.values()];
  }

  function mergeScannerRows(rowLists){
    const merged = new Map();
    arr(rowLists).flat().forEach(r => {
      if (!r?.name) return;
      const key = r.itemId || r.id || slug(r.name);
      const old = merged.get(key);
      if (!old) { merged.set(key, { ...r, detected: arr(r.detected), stackSources: arr(r.stackSources) }); return; }
      arr(r.detected).forEach(d => { if (!old.detected.includes(d)) old.detected.push(d); });
      arr(r.stackSources).forEach(src => {
        if (!old.stackSources.includes(src)) {
          old.stackSources.push(src);
          old.qty = Math.max(0, num(old.qty,0)) + Math.max(1, num(r.qty,1));
        }
      });
      if (!arr(r.stackSources).length) old.qty = Math.max(num(old.qty,1), num(r.qty,1));
      old.confidence = Math.max(num(old.confidence), num(r.confidence));
      old.selected = old.selected || r.selected;
      if (String(r.method || '').includes('exact')) old.method = r.method;
    });
    return [...merged.values()];
  }

  function rowsFromOcrResult(result){
    const catalogue = catalogueV29();
    const index = buildAliasIndex();
    const found = new Map();
    scannerFragmentsFromOcr(result).forEach(f => {
      let match = bestMatchForFragment(f.text, index, catalogue, { highPrecision:true, strictExactOnly:true, ocrLabel:true });
      if (!match) match = bestMatchForFragment(f.text, index, catalogue, { highPrecision:true, strictExactOnly:false, ocrLabel:true });
      if (match) {
        match.detected = f.stackQty && f.qty > 1 ? `${f.text} x${f.qty}` : f.text;
        addScannerMatch(found, match, { qty:f.qty || 1, stackQty:!!f.stackQty, qtySource:match.detected });
      }
    });
    return [...found.values()];
  }

  function matchScannerOcrResult(result){
    ensureV29();
    const results = Array.isArray(result) ? result : [result];
    const rows = mergeScannerRows(results.map(rowsFromOcrResult))
      .sort((a,b) => b.confidence - a.confidence || String(a.name).localeCompare(String(b.name)))
      .slice(0, 160);
    state.stashScanner.pending = rows;
    state.stashScanner.rawText = results.map(r => r?.data?.text || '').filter(Boolean).join('\n--- OCR PASS ---\n');
    state.stashScanner.lastScanAt = new Date().toISOString();
    persist(true);
    return rows;
  }

  async function loadTesseract(){
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-ltt-tesseract]');
      if (existing) { existing.addEventListener('load', resolve, { once:true }); existing.addEventListener('error', reject, { once:true }); return; }
      const s = document.createElement('script');
      s.src = TESSERACT_CDN; s.async = true; s.dataset.lttTesseract = '1';
      s.onload = resolve; s.onerror = () => reject(new Error('Could not load Tesseract.js. Internet is needed for first OCR scan.'));
      document.head.appendChild(s);
    });
    return window.Tesseract;
  }

  function fileToDataUrl(file){
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
  }

  function filenameFromUrl(url){
    try {
      const u = new URL(url);
      return decodeURIComponent((u.pathname.split('/').filter(Boolean).pop() || 'remote-stash-image').split('?')[0]) || 'remote-stash-image';
    } catch { return 'remote-stash-image'; }
  }

  async function loadScannerUrlImage(){
    const input = $v29('stashScanUrl');
    const raw = String(input?.value || '').trim();
    if (!raw) throw new Error('Paste an image URL first.');
    let url;
    try { url = new URL(raw); } catch { throw new Error('That does not look like a valid URL.'); }
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http/https image URLs are supported.');
    scannerStatus('<span class="badge gold">Loading image URL...</span><span class="pill">Browser CORS rules apply</span>');
    try {
      const res = await fetch(url.href, { mode:'cors', cache:'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.type && !blob.type.startsWith('image/')) {
        // Some hosts return application/octet-stream for images, so warn but still try.
        console.warn('Scanner URL returned non-image mime type:', blob.type);
      }
      const dataUrl = await fileToDataUrl(blob);
      window.__lttScannerImageDataUrl = dataUrl;
      window.__lttScannerImageName = filenameFromUrl(url.href);
      window.__lttScannerImageSource = url.href;
      const preview = $v29('scannerPreview');
      if (preview) {
        preview.className = 'scanner-preview';
        preview.innerHTML = `<div class="meta">Loaded from URL: ${esc(url.href)}</div><img src="${dataUrl}" alt="Remote stash screenshot">`;
      }
      scannerStatus('<span class="badge green">URL loaded</span><span class="pill">Ready to scan</span>');
      return dataUrl;
    } catch (err) {
      const msg = err?.message || String(err);
      throw new Error(`Could not load that image URL. The host may block browser/CORS access. Try opening the URL, save the image, then upload the file. Details: ${msg}`);
    }
  }

  async function preprocessImage(dataUrl, mode){
    if (mode === 'raw') return dataUrl;
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    const maxW = 2600;
    const scale = img.width < 900 ? Math.min(3, 900 / img.width) : Math.min(1, maxW / img.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (mode === 'contrast') {
      const imgData = ctx.getImageData(0,0,canvas.width,canvas.height);
      const d = imgData.data;
      for (let i=0;i<d.length;i+=4){
        const g = (d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
        const c = Math.max(0, Math.min(255, (g - 90) * 2.05 + 128));
        d[i]=d[i+1]=d[i+2]=c;
      }
      ctx.putImageData(imgData,0,0);
    }
    return canvas.toDataURL('image/png');
  }

  function scannerStatus(html, cls=''){
    const el = $v29('scannerStatus');
    if (el) { el.className = `sync-status ${cls}`; el.innerHTML = html; }
  }

  async function runScannerOcr(){
    ensureV29();
    const input = $v29('stashScanFile');
    const file = input?.files?.[0];
    const urlText = String($v29('stashScanUrl')?.value || '').trim();
    if (!file && !window.__lttScannerImageDataUrl && !urlText) return notify('Choose a stash screenshot file or paste an image URL first.');
    try {
      scannerStatus('<span class="badge gold">Loading OCR engine...</span>');
      let dataUrl = window.__lttScannerImageDataUrl || '';
      let sourceName = window.__lttScannerImageName || 'remote image';
      if (file) {
        dataUrl = await fileToDataUrl(file);
        sourceName = file.name;
        window.__lttScannerImageDataUrl = dataUrl;
        window.__lttScannerImageName = file.name;
        window.__lttScannerImageSource = 'file';
      } else if (!dataUrl && urlText) {
        dataUrl = await loadScannerUrlImage();
        sourceName = window.__lttScannerImageName || urlText;
      }
      state.appPrefs.v29.lastImageName = sourceName;
      const preview = $v29('scannerPreview');
      if (preview && !preview.querySelector('img')) preview.innerHTML = `<img src="${dataUrl}" alt="Stash screenshot">`;
      const mode = $v29('scannerPreprocess')?.value || 'multi';
      state.appPrefs.v29.scannerMode = mode;
      const Tesseract = await loadTesseract();
      const modes = mode === 'multi' ? ['raw','contrast'] : [mode];
      const results = [];
      scannerStatus('<span class="badge gold">Scanning image text...</span><span class="pill">Multi-pass mode is slower but finds more labels/stack counts</span>');
      for (let i=0;i<modes.length;i++){
        const passMode = modes[i];
        const ocrImage = await preprocessImage(dataUrl, passMode);
        const result = await Tesseract.recognize(ocrImage, 'eng', {
          tessedit_pageseg_mode: '11',
          preserve_interword_spaces: '1',
          logger: m => {
            if (m?.status) scannerStatus(`<span class="badge gold">${esc(passMode)} · ${esc(m.status)}</span><span class="pill">pass ${i+1}/${modes.length} · ${Math.round(num(m.progress)*100)}%</span>`);
          }
        });
        results.push(result);
      }
      const text = results.map(r => r?.data?.text || '').filter(Boolean).join('\n');
      $v29('scannerRawText').value = text;
      const rows = matchScannerOcrResult(results);
      scannerStatus(`<span class="badge green">Scan complete</span><span class="pill">${rows.length} likely label match(es). Stack numbers are estimated when OCR sees them.</span>`);
      renderScannerResultsV29();
    } catch(err){
      console.error('Stash scanner OCR failed', err);
      scannerStatus(`<span class="badge red">OCR failed</span><span class="pill">${esc(err.message || err)}</span>`);
      notify('OCR failed. You can paste/edit text manually and press Match text.');
    }
  }

  function matchManualText(){
    const text = $v29('scannerRawText')?.value || '';
    const rows = matchScannerText(text);
    scannerStatus(`<span class="badge green">Text matched</span><span class="pill">${rows.length} possible item(s), exact/high precision only</span>`);
    renderScannerResultsV29();
  }

  function parseExternalItemLines(text){
    const rawLines = String(text || '').replace(/\r/g,'\n').split(/\n+/).map(v => v.trim()).filter(Boolean);
    const lines = [];
    rawLines.forEach(line => {
      let original = line.replace(/[•*-]+\s*/,'').trim();
      if (!original) return;
      // Strip common AI/table prefixes.
      original = original.replace(/^item\s*[:\-]\s*/i,'').replace(/^name\s*[:\-]\s*/i,'').trim();
      let qty = 1;
      let label = original;
      // 3x Duct tape / x3 Duct tape
      let m = label.match(/^x?\s*(\d{1,3})\s*[x×]\s+(.+)$/i);
      if (m) { qty = Math.max(1, num(m[1],1)); label = m[2].trim(); }
      // Duct tape x3 / Duct tape ×3
      m = label.match(/^(.+?)\s+[x×]\s*(\d{1,3})$/i);
      if (m) { qty = Math.max(1, num(m[2],1)); label = m[1].trim(); }
      // Duct tape, 3 / Duct tape - 3 / Duct tape: 3
      m = label.match(/^(.+?)[,;:\-]\s*(\d{1,3})$/i);
      if (m && !/["”]/.test(m[1])) { qty = Math.max(1, num(m[2],1)); label = m[1].trim(); }
      // Durability/use counters like Zvezda 5/5 should not become qty 5.
      label = label.replace(/\s+\d{1,3}\s*\/\s*\d{1,3}\s*$/,'').trim();
      // Magnum 20 can mean stack quantity, but STM 15" is part of the name.
      m = label.match(/^(.+?)\s+(\d{1,3})$/);
      if (m && !/["”]/.test(m[1])) {
        const maybeName = m[1].trim();
        const maybeQty = Math.max(1, num(m[2],1));
        const exactWithoutQty = bestMatchForFragment(maybeName, buildAliasIndex(), catalogueV29(), { highPrecision:true, strictExactOnly:true });
        if (exactWithoutQty) { label = maybeName; qty = maybeQty; }
      }
      label = label.replace(/^[-–—\s]+|[-–—\s]+$/g,'').trim();
      if (!label || scannerBadAlias(label)) return;
      lines.push({ original, label, qty });
    });
    return lines;
  }

  function matchExternalItemLines(text){
    ensureV29();
    const index = buildAliasIndex();
    const catalogue = catalogueV29();
    const found = new Map();
    parseExternalItemLines(text).forEach(entry => {
      let match = bestMatchForFragment(entry.label, index, catalogue, { highPrecision:true, strictExactOnly:true });
      if (!match) match = bestMatchForFragment(entry.label, index, catalogue, { highPrecision:true, strictExactOnly:false });
      if (match?.item) {
        match.detected = entry.original;
        addScannerMatch(found, match, { qty:entry.qty });
        const row = found.get(match.item.id || slug(match.item.name));
        if (row) {
          row.qty = Math.max(1, num(entry.qty,1));
          row.method = (row.method || match.method || 'text file match') + ' · text file';
          row.selected = match.confidence >= 88;
        }
      } else {
        const key = 'unmatched-' + slug(entry.label) + '-' + Math.random().toString(36).slice(2,7);
        found.set(key, { id:key, itemId:slug(entry.label), name:entry.label, shortName:'', iconLink:'', wikiLink:'', detected:[entry.original], qty:entry.qty, fir:false, selected:false, confidence:0, method:'no exact item match · edit before import' });
      }
    });
    const rows = [...found.values()].sort((a,b) => b.confidence - a.confidence || String(a.name).localeCompare(String(b.name))).slice(0, 200);
    state.stashScanner.pending = rows;
    state.stashScanner.rawText = text;
    state.stashScanner.lastScanAt = new Date().toISOString();
    persist(true);
    return rows;
  }

  function matchTextFileOrManual(){
    const text = $v29('scannerRawText')?.value || '';
    const rows = matchExternalItemLines(text);
    scannerStatus(`<span class="badge green">Text file/manual list matched</span><span class="pill">${rows.length} row(s), qty parsed where possible</span>`);
    renderScannerResultsV29();
  }

  function ensureScannerPage(){
    const main = document.querySelector('.content'); if (!main || $v29('stashscanner')) return;
    const section = document.createElement('section'); section.id = 'stashscanner'; section.className = 'page';
    section.innerHTML = `
      <div class="tip-panel" data-tip-id="stashscanner">
        <div class="tip-icon">i</div>
        <p><strong>Scanner note:</strong> image OCR is experimental and will not always read Tarkov stash screenshots correctly. For best results, use an AI/OCR tool such as OpenAI to read the screenshot into a text file with one item and quantity per line, then upload that text file here.</p>
        <button class="small muted-btn" onclick="hideTip('stashscanner')">Hide</button>
      </div>
      <div class="panel hero compact-hero">
        <div><span class="kicker">// Stash OCR</span><h2>Stash Scanner</h2><p>Upload screenshots, image URLs, pasted text, or a text file. Screenshot OCR is still rough, so a cleaned text file is the most reliable import method.</p></div>
        <div class="data-grid"><button id="scannerSyncItems" class="primary">Sync item list first</button><button id="scannerClearBtn" class="danger">Clear scan</button></div>
      </div>
      <div class="panel">
        <h2>1. Upload screenshot</h2>
        <p>Use a full stash screenshot, cropped item icon, or a direct image URL from ShareX/Kappa. First OCR load needs internet for Tesseract.js; all imports still save locally.</p>
        <div class="data-grid scanner-controls">
          <input id="stashScanFile" type="file" accept="image/*">
          <select id="scannerPreprocess"><option value="multi">Multi-pass scan (best)</option><option value="raw">Raw image mode (fast)</option><option value="contrast">Contrast text mode</option></select>
          <button id="scannerRunBtn" class="primary">Scan screenshot</button>
        </div>
        <div class="search-row scanner-url-row" style="margin-top:10px">
          <input id="stashScanUrl" placeholder="Paste image URL, e.g. https://kappa.lol/Y4Ykw9">
          <button id="scannerLoadUrlBtn">Load URL preview</button>
          <button id="scannerScanUrlBtn" class="primary">Scan URL</button>
        </div>
        <div id="scannerStatus" class="sync-status"><span class="badge gold">Ready</span><span class="pill">Sync items, upload file or paste URL, scan</span></div>
        <div id="scannerPreview" class="scanner-preview empty">No screenshot selected.</div>
      </div>
      <div class="panel">
        <h2>2. OCR text / manual fallback</h2>
        <p>If OCR misses a label, paste a list here or upload a text/CSV file from another OCR/AI tool. One item per line is best, for example <code>Zvezda 5/5</code>, <code>sag mk1</code>, <code>stm 15&quot;</code>, or <code>Duct tape x3</code>.</p>
        <div class="data-grid scanner-text-import" style="margin-bottom:10px">
          <input id="scannerTextFile" type="file" accept=".txt,.csv,.tsv,text/plain,text/csv">
          <button id="scannerTextFileMatchBtn" class="primary">Upload &amp; match text file</button>
        </div>
        <textarea id="scannerRawText" rows="6" placeholder="Example:
Zvezda 5/5
sag mk1
stm 15&quot;
Duct tape x3"></textarea>
        <div class="card-actions" style="margin-top:10px"><button id="scannerMatchTextBtn">Match pasted list</button><button id="scannerOldMatchBtn" class="muted-btn">Loose OCR text match</button><button id="scannerSampleBtn" class="muted-btn">Test with Razor</button></div>
      </div>
      <div class="panel">
        <h2>3. Review before import</h2>
        <p>Nothing is added until you confirm. Exact label matches are selected by default; fuzzy/uncertain guesses should be checked manually. Edit quantities, FIR status, or item names before import.</p>
        <div class="card-actions" style="margin:10px 0"><button id="scannerSelectHighBtn">Select high confidence</button><button id="scannerAllFirBtn">Mark selected as FIR</button><button id="scannerNoneFirBtn">Clear FIR</button><button id="scannerImportBtn" class="success">Import selected to Stash</button></div>
        <div id="scannerResults" class="v28-table-wrap empty">No scan results yet.</div>
      </div>`;
    const before = $v29('raid') || $v29('needed') || null;
    main.insertBefore(section, before);
    wireScannerPage();
  }

  function wireScannerPage(){
    $v29('scannerRunBtn')?.addEventListener('click', runScannerOcr);
    $v29('scannerLoadUrlBtn')?.addEventListener('click', async () => { try { await loadScannerUrlImage(); } catch(err){ console.error('Scanner URL load failed', err); scannerStatus(`<span class="badge red">URL failed</span><span class="pill">${esc(err.message || err)}</span>`); notify('Could not load that URL. Try saving/uploading the image if the host blocks CORS.'); } });
    $v29('scannerScanUrlBtn')?.addEventListener('click', async () => { try { window.__lttScannerImageDataUrl = ''; await loadScannerUrlImage(); await runScannerOcr(); } catch(err){ console.error('Scanner URL OCR failed', err); scannerStatus(`<span class="badge red">URL scan failed</span><span class="pill">${esc(err.message || err)}</span>`); notify('Could not scan that URL. Try saving/uploading the image if the host blocks CORS.'); } });
    $v29('scannerMatchTextBtn')?.addEventListener('click', matchTextFileOrManual);
    $v29('scannerOldMatchBtn')?.addEventListener('click', matchManualText);
    $v29('scannerTextFileMatchBtn')?.addEventListener('click', async () => {
      const file = $v29('scannerTextFile')?.files?.[0];
      if (!file) return notify('Choose a .txt or .csv file first.');
      const text = await file.text();
      const area = $v29('scannerRawText'); if (area) area.value = text;
      const rows = matchExternalItemLines(text);
      scannerStatus(`<span class="badge green">Text file imported</span><span class="pill">${esc(file.name)} · ${rows.length} row(s)</span>`);
      renderScannerResultsV29();
    });
    $v29('scannerSampleBtn')?.addEventListener('click', () => { $v29('scannerRawText').value = 'Razor\nZvezda 5/5\nsag mk1\nstm 15"\nDuct tape x3'; matchTextFileOrManual(); });
    $v29('scannerClearBtn')?.addEventListener('click', () => { ensureV29(); state.stashScanner.pending = []; state.stashScanner.rawText = ''; window.__lttScannerImageDataUrl=''; window.__lttScannerImageName=''; window.__lttScannerImageSource=''; persist(true); const t=$v29('scannerRawText'); if(t)t.value=''; const u=$v29('stashScanUrl'); if(u)u.value=''; const f=$v29('stashScanFile'); if(f)f.value=''; const tf=$v29('scannerTextFile'); if(tf)tf.value=''; const p=$v29('scannerPreview'); if(p){p.className='scanner-preview empty'; p.textContent='No screenshot selected.';} renderScannerResultsV29(); scannerStatus('<span class="badge gold">Cleared</span>'); });
    $v29('scannerSyncItems')?.addEventListener('click', async () => { if (typeof syncItemCatalogueV26 === 'function') await syncItemCatalogueV26(true); else notify('Use Sync Data first to pull the item catalogue.'); renderScannerResultsV29(); });
    $v29('scannerSelectHighBtn')?.addEventListener('click', () => { ensureV29(); state.stashScanner.pending.forEach(r => r.selected = num(r.confidence) >= 80); persist(true); renderScannerResultsV29(); });
    $v29('scannerAllFirBtn')?.addEventListener('click', () => { ensureV29(); state.stashScanner.pending.forEach(r => { if (r.selected) r.fir = true; }); persist(true); renderScannerResultsV29(); });
    $v29('scannerNoneFirBtn')?.addEventListener('click', () => { ensureV29(); state.stashScanner.pending.forEach(r => r.fir = false); persist(true); renderScannerResultsV29(); });
    $v29('scannerImportBtn')?.addEventListener('click', importSelectedScanRows);
    $v29('stashScanFile')?.addEventListener('change', async (ev) => {
      const file = ev.target.files?.[0]; if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        window.__lttScannerImageDataUrl = dataUrl;
        window.__lttScannerImageName = file.name;
        window.__lttScannerImageSource = 'file';
        const p=$v29('scannerPreview'); if(p){ p.className='scanner-preview'; p.innerHTML = `<div class="meta">Loaded file: ${esc(file.name)}</div><img src="${dataUrl}" alt="Uploaded stash screenshot">`; }
      } catch {}
    });
  }

  function renderScannerResultsV29(){
    ensureV29();
    const el = $v29('scannerResults'); if (!el) return;
    const rows = state.stashScanner.pending;
    if (!rows.length) { el.className='v28-table-wrap empty'; el.textContent='No scan results yet.'; return; }
    el.className = 'v28-table-wrap';
    const itemOptions = catalogueV29().slice(0, 2500).map(i => `<option value="${esc(i.name)}">${esc(i.shortName || i.name)}</option>`).join('');
    el.innerHTML = `<datalist id="scannerItemNames">${itemOptions}</datalist><table class="v28-table scanner-table"><thead><tr><th>Import</th><th>Matched item</th><th>Detected text</th><th>Qty</th><th>FIR</th><th>Confidence</th></tr></thead><tbody>${rows.map((r,idx) => `
      <tr>
        <td><input type="checkbox" ${r.selected ? 'checked' : ''} onchange="v29ScanUpdate(${idx},'selected',this.checked)"></td>
        <td>${r.iconLink ? `<img src="${esc(r.iconLink)}" alt="" class="v28-item-icon" loading="lazy">` : '<span class="v28-item-icon blank"></span>'}<input list="scannerItemNames" value="${esc(r.name)}" onchange="v29ScanUpdate(${idx},'name',this.value)" class="scanner-item-input"><br><span class="meta">${esc(r.shortName || r.itemId || '')}</span></td>
        <td><span class="scanner-detected">${esc(arr(r.detected).slice(0,4).join(', '))}</span><br><span class="meta">${esc(r.method || '')}${r.selected ? '' : ' · review before import'}</span></td>
        <td><input type="number" min="1" value="${num(r.qty,1)}" onchange="v29ScanUpdate(${idx},'qty',this.value)" class="scanner-qty-input"></td>
        <td><input type="checkbox" ${r.fir ? 'checked' : ''} onchange="v29ScanUpdate(${idx},'fir',this.checked)"></td>
        <td><span class="badge ${num(r.confidence) >= 90 ? 'green' : num(r.confidence) >= 75 ? 'gold' : 'red'}">${num(r.confidence)}%</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  window.v29ScanUpdate = function(idx, field, value){
    ensureV29(); const row = state.stashScanner.pending[idx]; if (!row) return;
    if (field === 'selected' || field === 'fir') row[field] = !!value;
    else if (field === 'qty') row.qty = Math.max(1, num(value,1));
    else if (field === 'name') {
      const item = findCatalogueV29(value) || { name:value, id:slug(value) };
      row.name = item.name || value; row.itemId = item.id || slug(value); row.shortName = item.shortName || ''; row.iconLink = item.iconLink || ''; row.wikiLink = item.wikiLink || '';
    }
    persist(true);
  };

  function importSelectedScanRows(){
    ensureV29();
    const selected = state.stashScanner.pending.filter(r => r.selected && r.name);
    if (!selected.length) return notify('No selected scanner rows to import.');
    selected.forEach(r => {
      const item = findCatalogueV29(r.itemId || r.name) || { id:r.itemId || slug(r.name), name:r.name, shortName:r.shortName, iconLink:r.iconLink, wikiLink:r.wikiLink };
      if (typeof window.addToStashV28 === 'function') window.addToStashV28(item, Math.max(1,num(r.qty,1)), { source:'stash scanner', fir:!!r.fir });
      else {
        state.stash.items.push({ id:crypto.randomUUID(), itemId:item.id || slug(item.name), name:item.name, shortName:item.shortName || '', qty:Math.max(1,num(r.qty,1)), firQty:r.fir ? Math.max(1,num(r.qty,1)) : 0, iconLink:item.iconLink || '', wikiLink:item.wikiLink || '', note:'Imported from Stash Scanner', source:'stash scanner', updatedAt:new Date().toISOString() });
      }
    });
    persist(true);
    notify(`Imported ${selected.length} scanner row(s) into Stash.`);
    try { if (typeof render === 'function') render(); } catch {}
  }

  function addSidebarTabV29(){
    const sidebar = document.querySelector('.sidebar'); if (!sidebar) return;
    if (!sidebar.querySelector('[data-page="stashscanner"]')) {
      const btn = document.createElement('button'); btn.className = 'tab'; btn.dataset.page = 'stashscanner'; btn.dataset.num = '04';
      btn.innerHTML = `<span class="tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h4M7 12h10M7 16h7"/><path d="M16 8h1"/></svg></span>Stash Scanner`;
      btn.addEventListener('click', () => switchPageV29('stashscanner'));
      const foot = sidebar.querySelector('.sidebar-foot'); sidebar.insertBefore(btn, foot || null);
    }
    const foot = sidebar.querySelector('.sidebar-foot'); let anchor = foot || null;
    [...PAGE_ORDER].reverse().forEach(page => { const tab = sidebar.querySelector(`.tab[data-page="${page}"]`); if (tab) { sidebar.insertBefore(tab, anchor); anchor = tab; } });
    PAGE_ORDER.forEach((page, idx) => { const tab = sidebar.querySelector(`.tab[data-page="${page}"]`); if (tab) tab.dataset.num = String(idx+1).padStart(2,'0'); });
    const build = document.querySelector('.sidebar-foot .foot-row:last-child b'); if (build) build.textContent = 'v0.3.4';
    const subtitle = document.querySelector('.topbar-sub'); if (subtitle) subtitle.textContent = 'Offline raid, stash, scanner, market & locker tracker // v0.3.4';
  }

  function switchPageV29(id){
    ensureScannerPage(); addSidebarTabV29();
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === id));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === id));
    if (id === 'stashscanner') renderScannerResultsV29();
    else try { if (typeof render === 'function') render(); } catch {}
  }

  const oldRenderV29 = (typeof render === 'function') ? render : null;
  window.render = render = function renderV29(){
    ensureV29(); ensureScannerPage();
    try { if (oldRenderV29) oldRenderV29(); } catch(err){ console.warn('v29 base render warning', err); }
    ensureScannerPage(); addSidebarTabV29();
    if (document.querySelector('.page.active')?.id === 'stashscanner') renderScannerResultsV29();
  };

  document.addEventListener('DOMContentLoaded', () => { ensureV29(); ensureScannerPage(); addSidebarTabV29(); setTimeout(() => { try { render(); } catch(err){ console.warn('v29 initial render warning', err); } }, 120); });

  const css = document.createElement('style');
  css.textContent = `
    .scanner-controls{grid-template-columns:minmax(220px,1fr) minmax(170px,220px) auto;}
    .scanner-url-row{grid-template-columns:minmax(260px,1fr) auto auto;}
    .scanner-text-import{grid-template-columns:minmax(260px,1fr) auto;}
    .scanner-preview{margin-top:14px;max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:var(--radius);background:#050708;padding:10px;}
    .scanner-preview img{display:block;max-width:100%;height:auto;margin:0 auto;border-radius:4px;}
    .scanner-table .scanner-item-input{min-width:260px;max-width:380px;display:inline-block;width:calc(100% - 60px);}
    .scanner-qty-input{width:76px;}
    .scanner-detected{font-family:var(--font-mono);color:var(--text-2);}
    @media (max-width:900px){.scanner-controls,.scanner-url-row,.scanner-text-import{grid-template-columns:1fr}.scanner-table .scanner-item-input{width:100%;display:block;margin-top:6px}}
  `;
  document.head.appendChild(css);

  try { ensureV29(); ensureScannerPage(); addSidebarTabV29(); console.info(`${BUILD} loaded.`); } catch(err){ console.warn('v29 setup warning', err); }
})();
