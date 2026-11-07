const iconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
  equipment: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 7h6m-6 4h6m-6 6h.01"/>',
  tool: '<path d="M14 7a5 5 0 0 0-6 6l-4 4a2 2 0 0 0 3 3l4-4a5 5 0 0 0 6-6l-3 3-3-3z"/>',
  report: '<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7M8 14h8m-8 3h6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.3 4.6a2 2 0 0 1 3.4 0l7.4 12.7a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3zM12 9v4m0 3h.01"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

const byId = (id) => document.getElementById(id);
const form = byId('edit-form');
const dialog = byId('editor');
const search = byId('search');
const setup = byId('setup-filter');
const condition = byId('condition-filter');
const noteFilter = byId('note-filter');
const views = {
  overview: ['Overview', 'Lab overview'],
  workstations: ['Workstations', 'Workstations'],
  equipment: ['Equipment', 'Equipment'],
  maintenance: ['Maintenance', 'Maintenance'],
  reports: ['Reports', 'Reports'],
};
const statusClass = {
  Good: 'good', Fair: 'warn', 'Needs repair': 'warn', 'Out of service': 'bad',
  Ready: 'good', 'In progress': 'progress', Blocked: 'bad',
};
const labDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric',
});
const labDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
let records = [];
let equipment = [];
let equipmentById = new Map();
let loadState = 'loading';
let selected;
let returnFocus;
let saving = false;
let downloading = false;

function icon(target, name) {
  target.dataset.icon = name;
  target.setAttribute('aria-hidden', 'true');
  target.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + iconPaths[name] + '</svg>';
}
document.querySelectorAll('[data-icon]').forEach((node) => icon(node, node.dataset.icon));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function announce(message, error = false, retry) {
  const notice = byId('notice');
  notice.hidden = !message;
  notice.classList.toggle('error', error);
  notice.textContent = message;
  if (retry) {
    const button = element('button', 'link-button', 'Try again');
    button.type = 'button';
    button.addEventListener('click', retry);
    notice.append(button);
  }
}

function selectView() {
  const hash = location.hash.slice(1);
  if (hash === 'main') return;
  const view = Object.hasOwn(views, hash) ? hash : 'overview';
  byId('breadcrumb').textContent = views[view][0];
  byId('page-title').textContent = views[view][1];
  document.querySelectorAll('nav [data-view]').forEach((link) => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  byId('overview-content').hidden = view !== 'overview';
  byId('inventory-content').hidden = !['overview', 'workstations'].includes(view);
  byId('equipment-content').hidden = view !== 'equipment';
  byId('maintenance-content').hidden = view !== 'maintenance';
  byId('reports-content').hidden = view !== 'reports';
  window.scrollTo(0, 0);
}

function matches(record) {
  const query = search.value.toLowerCase().trim();
  const linked = [equipmentById.get(record.monitorId), equipmentById.get(record.systemUnitId)].filter(Boolean);
  const fields = [record.code, ...Object.values(record.details),
    ...linked.flatMap((asset) => [asset.assetTag, ...Object.values(asset.details)])].map((value) => value.toLowerCase());
  return (!query || query.split(/\s+/).every((term) => fields.some((field) => field.includes(term)))) &&
    (!setup.value || record.details.setup === setup.value) &&
    (!condition.value || record.details.condition === condition.value);
}

function makeRow(record) {
  const { details } = record;
  const row = element('tr');
  const workstation = element('td');
  const stationButton = element('button', 'station-button');
  stationButton.type = 'button';
  const glyph = element('span', 'station-icon');
  icon(glyph, 'monitor');
  stationButton.append(glyph, document.createTextNode(record.code));
  stationButton.addEventListener('click', () => openEditor(record.number, stationButton));
  workstation.append(stationButton);

  const equipment = element('td', 'model');
  const unit = equipmentById.get(record.systemUnitId);
  const monitor = equipmentById.get(record.monitorId);
  const label = unit ? unit.assetTag + ' · ' + unit.details.model : details.model;
  equipment.append(element('div', label ? '' : 'muted', label || 'System unit unassigned'));
  if (monitor) equipment.append(element('span', '', 'Monitor · ' + monitor.assetTag + ' · ' + monitor.details.model));
  else if (details.monitor || details.assetTag || details.serial) {
    equipment.append(element('span', '', details.monitor || details.assetTag || details.serial));
  }
  const badges = [details.condition, details.setup].map((value) => {
    const cell = element('td');
    cell.append(element('span', 'pill ' + (statusClass[value] || 'neutral'), value));
    return cell;
  });
  const updated = element('td', 'date-cell', record.updatedAt ? labDate.format(new Date(record.updatedAt)) : '—');
  const actions = element('td', 'row-action');
  const edit = element('button', 'icon-button');
  edit.type = 'button';
  edit.setAttribute('aria-label', 'Edit ' + record.code);
  const arrow = element('span');
  icon(arrow, 'arrow');
  edit.append(arrow);
  edit.addEventListener('click', () => openEditor(record.number, edit));
  actions.append(edit);
  row.append(workstation, equipment, ...badges, updated, actions);
  return row;
}

function renderInventory() {
  const list = records.filter(matches);
  byId('inventory-rows').replaceChildren(...list.map(makeRow));
  const state = byId('inventory-state');
  state.hidden = loadState === 'ready' && list.length > 0;
  state.textContent = loadState === 'loading' ? 'Loading workstations…'
    : loadState === 'error' ? 'Inventory could not be loaded.' : 'No workstations match these filters.';
  byId('results').textContent = loadState === 'ready' ? `Showing ${list.length} of ${records.length} workstations` : 'Inventory';
  byId('reset-filters').hidden = !search.value && !setup.value && !condition.value;
  const counts = [
    records.length,
    records.filter(({ details }) => details.setup === 'Ready').length,
    records.filter(({ details }) => details.setup === 'In progress').length,
    records.filter(({ details }) => details.setup === 'Blocked' ||
      ['Needs repair', 'Out of service'].includes(details.condition)).length,
  ];
  ['total-count', 'ready-count', 'progress-count', 'attention-count'].forEach((id, index) => {
    byId(id).textContent = loadState === 'ready' ? counts[index] : '—';
  });
  const paired = records.filter((record) => record.monitorId && record.systemUnitId).length;
  byId('paired-count').textContent = loadState === 'ready' ? paired + ' fully paired' : '— fully paired';
  document.querySelectorAll('[data-download]').forEach((button) => {
    button.disabled = loadState !== 'ready' || downloading;
  });
}

function noteEntry(note, record) {
  const entry = element('article', 'note-entry');
  const meta = element('div', 'note-meta');
  if (record) {
    const button = element('button', 'station-button', record.code);
    button.type = 'button';
    button.addEventListener('click', () => openEditor(record.number, button));
    meta.append(button);
  }
  const date = element('time', '', labDateTime.format(new Date(note.createdAt)) + ' EAT');
  date.dateTime = note.createdAt;
  meta.append(element('span', 'pill neutral', note.category), date);
  entry.append(meta, element('p', '', note.text));
  return entry;
}

function renderNotes() {
  const number = Number(noteFilter.value);
  const notes = records
    .filter((record) => !number || record.number === number)
    .flatMap((record) => record.notes.map((note) => ({ note, record })))
    .sort((a, b) => b.note.createdAt.localeCompare(a.note.createdAt));
  const empty = loadState === 'ready' ? 'No maintenance notes recorded.' : 'Maintenance history is unavailable.';
  byId('maintenance-notes').replaceChildren(...(notes.length
    ? notes.map(({ note, record }) => noteEntry(note, record))
    : [element('div', 'state', empty)]));
  byId('open-note').disabled = loadState !== 'ready' || !number;
}

async function refreshRecords() {
  const response = await fetch('/api/inventory', { cache: 'no-store' });
  if (!response.ok) throw new Error('Inventory could not be loaded.');
  const data = await response.json();
  records = data.records;
  setEquipment(data.equipment);
}

async function load() {
  loadState = 'loading';
  announce('');
  renderInventory();
  try {
    await refreshRecords();
    const previous = noteFilter.value;
    noteFilter.replaceChildren(new Option('All workstations', ''), ...records.map((record) => new Option(record.code, record.number)));
    noteFilter.value = previous;
    loadState = 'ready';
  } catch {
    loadState = 'error';
    announce('The inventory could not be loaded. Confirm that you are signed in with the account that owns this site.', true, load);
  }
  renderInventory();
  renderEquipment();
  renderNotes();
}

function openEditor(number, trigger) {
  const record = records.find((item) => item.number === number);
  if (!record) return;
  selected = record;
  if (!dialog.open) returnFocus = trigger;
  byId('editor-title').textContent = record.code;
  byId('editor-meta').textContent = record.updatedAt
    ? 'Last saved ' + labDateTime.format(new Date(record.updatedAt)) + ' EAT' : 'No inspection saved yet';
  byId('edit-error').hidden = true;
  byId('reload-record').hidden = true;
  form.reset();
  for (const [key, value] of Object.entries(record.details)) form.elements.namedItem(key).value = value;
  for (const [name, kind] of [['monitorId', 'monitor'], ['systemUnitId', 'system-unit']]) {
    const options = equipment.filter((asset) => asset.kind === kind &&
      (!asset.workstationNumber || asset.workstationNumber === number));
    const field = form.elements.namedItem(name);
    field.replaceChildren(new Option('Unassigned', ''), ...options.map((asset) =>
      new Option(asset.assetTag + ' · ' + asset.details.model, asset.id)
    ));
    field.value = record[name] ?? '';
  }
  byId('editor-notes').replaceChildren(...(record.notes.length
    ? record.notes.map((note) => noteEntry(note))
    : [element('div', 'state', 'No maintenance notes for this workstation.')]));
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.editor-body').scrollTop = 0;
}

function editError(message, conflict = false) {
  const alert = byId('edit-error');
  alert.hidden = false;
  alert.textContent = message;
  byId('reload-record').hidden = !conflict;
  dialog.querySelector('.editor-body').scrollTop = 0;
}

function setSaving(value) {
  saving = value;
  const button = byId('save-edit');
  button.disabled = value;
  button.lastElementChild.textContent = value ? 'Saving…' : 'Save changes';
  byId('close-editor').disabled = value;
  byId('cancel-edit').disabled = value;
}

async function saveEdit(event) {
  event.preventDefault();
  if (!selected || saving) return;
  const fields = new FormData(form);
  const details = Object.fromEntries(Object.keys(selected.details).map((name) => [name, fields.get(name).trim()]));
  const text = fields.get('noteText').trim();
  const note = text ? { category: fields.get('noteCategory'), text } : undefined;
  const monitorId = fields.get('monitorId') || null;
  const systemUnitId = fields.get('systemUnitId') || null;
  if (!note && monitorId === selected.monitorId && systemUnitId === selected.systemUnitId &&
      Object.keys(details).every((key) => details[key] === selected.details[key])) {
    editError('Change a pairing, update the record, or add a note before saving.');
    return;
  }
  setSaving(true);
  try {
    const response = await fetch('/api/inventory/' + selected.number, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: selected.revision, details, note, monitorId, systemUnitId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      editError(data.error || 'The changes could not be saved. Confirm that you are still signed in.', response.status === 409);
      return;
    }
    records = records.map((item) => item.number === data.record.number ? data.record : item);
    const chosen = [data.record.monitorId, data.record.systemUnitId];
    setEquipment(equipment.map((asset) => {
      if (chosen.includes(asset.id)) return { ...asset, workstationNumber: data.record.number };
      if (asset.workstationNumber === data.record.number) return { ...asset, workstationNumber: null };
      return asset;
    }));
    renderInventory();
    renderEquipment();
    renderNotes();
    dialog.close();
    announce(data.record.code + ' saved.' + (note ? ' Maintenance note added.' : ''));
  } catch {
    editError('The save could not be confirmed. Check your connection and retry.');
  } finally {
    setSaving(false);
  }
}

async function downloadReport() {
  if (downloading) return;
  downloading = true;
  const buttons = [...document.querySelectorAll('[data-download]')];
  const labels = buttons.map((button) => button.lastElementChild.textContent);
  buttons.forEach((button) => {
    button.disabled = true;
    button.lastElementChild.textContent = 'Generating PDF…';
  });
  try {
    const response = await fetch('/api/report.pdf', { cache: 'no-store' });
    if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/pdf')) {
      throw new Error('PDF unavailable');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = element('a');
    link.href = url;
    link.download = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'Rehema-Computer-Lab.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    announce('Lab report downloaded.');
  } catch {
    announce('The PDF could not be downloaded. Confirm that you are still signed in and try again.', true);
  } finally {
    downloading = false;
    buttons.forEach((button, index) => {
      button.disabled = loadState !== 'ready';
      button.lastElementChild.textContent = labels[index];
    });
  }
}

window.addEventListener('hashchange', selectView);
search.addEventListener('input', renderInventory);
[setup, condition].forEach((item) => item.addEventListener('change', renderInventory));
byId('reset-filters').addEventListener('click', () => {
  search.value = setup.value = condition.value = '';
  renderInventory();
  search.focus();
});
noteFilter.addEventListener('change', renderNotes);
byId('open-note').addEventListener('click', (event) => openEditor(Number(noteFilter.value), event.currentTarget));
form.addEventListener('submit', saveEdit);
[byId('close-editor'), byId('cancel-edit')].forEach((button) => button.addEventListener('click', () => dialog.close()));
dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); });
dialog.addEventListener('close', () => {
  if (returnFocus?.isConnected && !returnFocus.closest('[hidden]')) returnFocus.focus();
  else if (!byId('inventory-content').hidden) {
    const replacement = byId('inventory-rows').querySelector('[aria-label="Edit ' + selected.code + '"]');
    (replacement || search).focus();
  } else byId('open-note').focus();
});
byId('reload-record').addEventListener('click', async () => {
  if (saving) return;
  const button = byId('reload-record');
  button.disabled = true;
  try {
    await refreshRecords();
    renderInventory();
    renderEquipment();
    renderNotes();
    if (dialog.open) openEditor(selected.number);
  } catch {
    if (dialog.open) editError('The saved record could not be loaded. Try again.', true);
  } finally {
    button.disabled = false;
  }
});
document.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', downloadReport));
