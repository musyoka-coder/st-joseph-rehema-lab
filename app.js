const stationCount = 13;
const conditions = ['Not assessed', 'Good', 'Fair', 'Needs repair', 'Out of service'];
const setups = ['Not started', 'In progress', 'Ready', 'Blocked'];
const limits = {
  model: 120, serial: 100, assetTag: 100, processor: 100, memory: 60, storage: 80,
  operatingSystem: 100, monitor: 140, keyboard: 140, mouse: 140, network: 120, power: 120,
};
const categories = ['Inspection', 'Setup', 'Repair', 'Follow-up'];
const blankDetails = Object.freeze({
  ...Object.fromEntries(Object.keys(limits).map((key) => [key, ''])),
  condition: conditions[0],
  setup: setups[0],
});

function station(number, row) {
  return {
    number,
    code: 'PC-' + String(number).padStart(2, '0'),
    revision: row?.revision ?? 0,
    details: row ? { ...blankDetails, ...JSON.parse(row.details) } : { ...blankDetails },
    notes: row ? JSON.parse(row.notes) : [],
    updatedAt: row?.updated_at ?? null,
    monitorId: row?.monitor_id ?? null,
    systemUnitId: row?.system_unit_id ?? null,
  };
}

async function allStations(db) {
  const { results } = await db.prepare('SELECT * FROM workstation_edits ORDER BY number').all();
  const byNumber = new Map(results.map((row) => [row.number, row]));
  return Array.from({ length: stationCount }, (_, index) => station(index + 1, byNumber.get(index + 1)));
}

function parseEdit(input) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0 ||
      !input.details || typeof input.details !== 'object') {
    return { error: 'The workstation record is incomplete.' };
  }
  const { condition, setup } = input.details;
  if (!conditions.includes(condition) || !setups.includes(setup)) {
    return { error: 'Choose a valid condition and setup status.' };
  }
  const details = { condition, setup };
  for (const [name, limit] of Object.entries(limits)) {
    const value = input.details[name];
    if (typeof value !== 'string' || value.trim().length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
      return { error: 'One of the equipment fields is invalid or too long.' };
    }
    details[name] = value.trim();
  }
  let note;
  if (input.note != null) {
    const { category, text } = input.note;
    if (!categories.includes(category) || typeof text !== 'string' || !text.trim() ||
        text.trim().length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      return { error: 'Enter a maintenance note of up to 2,000 characters and choose its category.' };
    }
    note = { category, text: text.trim() };
  }
  const links = { monitorId: input.monitorId, systemUnitId: input.systemUnitId };
  if (Object.values(links).some((id) => id != null &&
      (typeof id !== 'string' || !equipmentIdPattern.test(id)))) {
    return { error: 'Choose valid equipment from the inventory.' };
  }
  return { revision: input.revision, details, note, ...links };
}

async function saveStation(db, number, edit) {
  const row = await db.prepare('SELECT * FROM workstation_edits WHERE number = ?').bind(number).first();
  const current = station(number, row);
  if (current.revision !== edit.revision) return { conflict: true };
  const monitorId = edit.monitorId === undefined ? current.monitorId : edit.monitorId;
  const systemUnitId = edit.systemUnitId === undefined ? current.systemUnitId : edit.systemUnitId;
  const updatedAt = new Date().toISOString();
  const notes = current.notes;
  if (edit.note) {
    if (notes.length >= 100) return { error: 'This workstation has reached its 100-note limit.' };
    notes.unshift({ ...edit.note, createdAt: updatedAt, id: crypto.randomUUID() });
  }
  const details = JSON.stringify(edit.details);
  const history = JSON.stringify(notes);
  try {
    const result = row
      ? await db.prepare(`UPDATE workstation_edits
          SET revision = revision + 1, details = ?, notes = ?, updated_at = ?, monitor_id = ?, system_unit_id = ?
          WHERE number = ? AND revision = ?`)
        .bind(details, history, updatedAt, monitorId, systemUnitId, number, edit.revision).run()
      : await db.prepare(`INSERT INTO workstation_edits
          (number, revision, details, notes, updated_at, monitor_id, system_unit_id)
          VALUES (?, 1, ?, ?, ?, ?, ?) ON CONFLICT(number) DO NOTHING`)
        .bind(number, details, history, updatedAt, monitorId, systemUnitId).run();
    if (result.meta.changes !== 1) return { conflict: true };
  } catch (error) {
    if (/station_(monitor|system_unit)_once|workstation_edits\.(monitor_id|system_unit_id)/.test(error.message)) {
      return { conflict: 'One of those assets is already assigned to another workstation. Reload the available equipment.' };
    }
    if (/invalid workstation equipment type|station_(monitor|system_unit)_kind/.test(error.message)) {
      return { error: 'Select a registered monitor and system unit from their respective lists.' };
    }
    throw error;
  }
  return { record: station(number, {
    revision: edit.revision + 1, details, notes: history, updated_at: updatedAt,
    monitor_id: monitorId, system_unit_id: systemUnitId,
  }) };
}

function totals(records) {
  return {
    stations: records.length,
    ready: records.filter(({ details }) => details.setup === 'Ready').length,
    inProgress: records.filter(({ details }) => details.setup === 'In progress').length,
    attention: records.filter(({ details }) => details.setup === 'Blocked' ||
      ['Needs repair', 'Out of service'].includes(details.condition)).length,
  };
}
const equipmentKinds = ['monitor', 'system-unit'];
const equipmentLimits = {
  model: 120, serial: 100, displaySize: 60, ports: 100, processor: 100,
  memory: 60, storage: 80, operatingSystem: 100, remarks: 600,
};
const equipmentIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const equipmentSelect = `SELECT e.*, COALESCE(m.number, u.number) AS workstation_number
  FROM lab_equipment e
  LEFT JOIN workstation_edits m ON m.monitor_id = e.id
  LEFT JOIN workstation_edits u ON u.system_unit_id = e.id`;

function equipmentRecord(row) {
  return {
    id: row.id, kind: row.kind, assetTag: row.asset_tag, details: JSON.parse(row.details),
    revision: row.revision, updatedAt: row.updated_at, workstationNumber: row.workstation_number ?? null,
  };
}

async function allEquipment(db) {
  const { results } = await db.prepare(equipmentSelect + ' ORDER BY e.kind, lower(e.asset_tag)').all();
  return results.map(equipmentRecord);
}

function parseEquipment(input) {
  if (!input || !equipmentKinds.includes(input.kind) || !Number.isSafeInteger(input.revision) ||
      input.revision < 0 || !conditions.includes(input.details?.condition)) {
    return { error: 'Choose a valid equipment type and condition.' };
  }
  const assetTag = equipmentText(input.assetTag, 100);
  if (!assetTag) return { error: 'Enter an asset tag of up to 100 characters.' };
  const details = { condition: input.details.condition };
  for (const [key, limit] of Object.entries(equipmentLimits)) {
    const value = equipmentText(input.details[key] ?? '', limit);
    if (value === null) return { error: 'One of the equipment fields is invalid or too long.' };
    details[key] = value;
  }
  if (!details.model) return { error: 'Enter the equipment make or model.' };
  return { kind: input.kind, assetTag, details, revision: input.revision };
}

function equipmentText(value, limit) {
  if (typeof value !== 'string' || value.trim().length > limit || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}

async function saveEquipment(db, id, edit) {
  const updatedAt = new Date().toISOString();
  const details = JSON.stringify(edit.details);
  const updating = Boolean(id);
  const assetId = id || crypto.randomUUID();
  try {
    const result = updating
      ? await db.prepare(`UPDATE lab_equipment SET asset_tag = ?, details = ?, updated_at = ?, revision = revision + 1
          WHERE id = ? AND kind = ? AND revision = ?`)
        .bind(edit.assetTag, details, updatedAt, id, edit.kind, edit.revision).run()
      : await db.prepare(`INSERT INTO lab_equipment (id, kind, asset_tag, details, revision, updated_at)
          VALUES (?, ?, ?, ?, 1, ?)`).bind(assetId, edit.kind, edit.assetTag, details, updatedAt).run();
    if (result.meta.changes !== 1) return { conflict: 'This equipment record changed. Reload before editing it again.' };
  } catch (error) {
    if (/lab_equipment_asset_tag/.test(error.message)) return { conflict: 'That asset tag is already in use.' };
    throw error;
  }
  return { equipment: equipmentRecord(await db.prepare(equipmentSelect + ' WHERE e.id = ?').bind(assetId).first()) };
}

async function inventorySnapshot(db) {
  const [records, equipment] = await Promise.all([allStations(db), allEquipment(db)]);
  return { records, equipment };
}
const demoKey = 'rehema-lab-demo-v1';

async function demoFetch(path, options = {}) {
  const state = JSON.parse(localStorage.getItem(demoKey) || 'null') || {
    records: Array.from({ length: stationCount }, (_, index) => station(index + 1)),
    equipment: [],
  };
  const reply = (body, status = 200) => Response.json(body, { status });
  if (path === '/api/inventory') return reply(state);
  if (path === '/api/report.pdf') {
    const { PDFDocument, StandardFonts, rgb } = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let page, y;
    function write(value, size = 10) {
      if (!page || y < 45) { page = pdf.addPage([595, 842]); y = 800; }
      const clean = String(value).replace(/[^ -~]/g, ' ');
      page.drawText(clean.slice(0, 110), { x: 40, y, size, font, color: rgb(.07,.24,.19) });
      y -= size + 7;
    }
    write('St. Joseph Rehema College', 21);
    write('Computer Lab Inventory | Demo', 15);
    for (const record of state.records) {
      const tags = [record.systemUnitId, record.monitorId].map(id => state.equipment.find(asset => asset.id === id)?.assetTag).filter(Boolean);
      write([record.code, record.details.condition, record.details.setup, ...tags].join('  |  '));
      for (const note of record.notes) {
        const lines = (note.category + ': ' + note.text).match(/[^\r\n]{1,95}/g) || [];
        lines.forEach(line => write(line));
      }
    }
    write('Equipment register', 15);
    for (const asset of state.equipment) write([asset.assetTag, asset.kind, asset.details.model, asset.details.condition].join('  |  '));
    return new Response(await pdf.save(), {headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="Rehema-Lab-Demo.pdf"',
    }});
  }
  const input = JSON.parse(options.body);
  if (path.startsWith('/api/equipment')) {
    const edit = parseEquipment(input);
    if (edit.error) return reply(edit, 400);
    const id = path.split('/')[3];
    const old = state.equipment.find(asset => asset.id === id);
    if (id && (!old || old.revision !== edit.revision)) return reply({error:'Reload the equipment record.'}, 409);
    if (state.equipment.some(asset => asset.id !== id && asset.assetTag.toLowerCase() === edit.assetTag.toLowerCase())) {
      return reply({error:'That asset tag is already in use.'}, 409);
    }
    const asset = {...edit, id: id || crypto.randomUUID(), revision: edit.revision + 1,
      updatedAt: new Date().toISOString(), workstationNumber: old?.workstationNumber ?? null};
    state.equipment = [...state.equipment.filter(item => item.id !== id), asset];
    localStorage.setItem(demoKey, JSON.stringify(state));
    return reply({equipment: asset}, id ? 200 : 201);
  }
  const edit = parseEdit(input);
  if (edit.error) return reply(edit, 400);
  const current = state.records[Number(path.split('/')[3]) - 1];
  if (!current || current.revision !== edit.revision) return reply({error:'Reload the workstation record.'}, 409);
  for (const [id, kind] of [[edit.monitorId, 'monitor'], [edit.systemUnitId, 'system-unit']]) {
    if (!id) continue;
    const asset = state.equipment.find(item => item.id === id && item.kind === kind);
    if (!asset || (asset.workstationNumber && asset.workstationNumber !== current.number)) {
      return reply({error:'That equipment is unavailable.'}, 409);
    }
  }
  const updatedAt = new Date().toISOString();
  const record = {...current, details: edit.details, revision: edit.revision + 1, updatedAt,
    monitorId: edit.monitorId, systemUnitId: edit.systemUnitId};
  if (edit.note) record.notes = [{...edit.note, createdAt: updatedAt, id: crypto.randomUUID()}, ...record.notes];
  state.records[record.number - 1] = record;
  for (const asset of state.equipment) {
    if ([record.monitorId, record.systemUnitId].includes(asset.id)) asset.workstationNumber = record.number;
    else if (asset.workstationNumber === record.number) asset.workstationNumber = null;
  }
  localStorage.setItem(demoKey, JSON.stringify(state));
  return reply({record});
}
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
  const response = await demoFetch('/api/inventory', { cache: 'no-store' });
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
    const response = await demoFetch('/api/inventory/' + selected.number, {
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
    const response = await demoFetch('/api/report.pdf', { cache: 'no-store' });
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
const equipmentDialog = byId('equipment-editor');
const equipmentForm = byId('equipment-form');
const equipmentSearch = byId('equipment-search');
const equipmentFilter = byId('equipment-filter');
const assignmentFilter = byId('assignment-filter');
const equipmentLabels = { monitor: 'Monitor', 'system-unit': 'System unit' };
let selectedEquipment;
let equipmentTrigger;
let savingEquipment = false;

function setEquipment(assets) {
  equipment = assets;
  equipmentById = new Map(assets.map((asset) => [asset.id, asset]));
}

function workstationCode(number) {
  return 'PC-' + String(number).padStart(2, '0');
}

function renderEquipment() {
  const term = equipmentSearch.value.trim().toLowerCase();
  const visible = equipment.filter((asset) => {
    const assigned = Boolean(asset.workstationNumber);
    const words = [asset.assetTag, equipmentLabels[asset.kind], asset.details.model, asset.details.serial,
      assigned ? workstationCode(asset.workstationNumber) : ''].join(' ').toLowerCase();
    return words.includes(term) && (!equipmentFilter.value || equipmentFilter.value === asset.kind) &&
      (!assignmentFilter.value || assigned === (assignmentFilter.value === 'assigned'));
  });
  const rows = visible.map((asset) => {
    const row = element('tr');
    const label = element('button', 'station-button', asset.assetTag);
    label.type = 'button';
    label.addEventListener('click', () => openEquipmentEditor(asset.kind, label, asset));
    const tag = element('td');
    tag.append(label);
    const badge = element('td');
    badge.append(element('span', 'pill ' + (statusClass[asset.details.condition] || 'neutral'), asset.details.condition));
    const assignment = element('td');
    if (asset.workstationNumber) {
      const workstation = element('button', 'station-button', workstationCode(asset.workstationNumber));
      workstation.type = 'button';
      workstation.addEventListener('click', () => openEditor(asset.workstationNumber, workstation));
      assignment.append(workstation);
    } else assignment.textContent = 'Unassigned';
    const action = element('td', 'row-action');
    const edit = element('button', 'icon-button');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit equipment ' + asset.assetTag);
    const glyph = element('span');
    icon(glyph, 'arrow');
    edit.append(glyph);
    edit.addEventListener('click', () => openEquipmentEditor(asset.kind, edit, asset));
    action.append(edit);
    row.append(tag, element('td', '', equipmentLabels[asset.kind]), element('td', 'model', asset.details.model), badge, assignment, action);
    return row;
  });
  byId('equipment-rows').replaceChildren(...rows);
  const state = byId('equipment-state');
  state.hidden = visible.length > 0;
  state.textContent = loadState !== 'ready' ? 'Equipment inventory is unavailable.'
    : equipment.length ? 'No equipment matches these filters.' : 'No equipment registered. Add a monitor or system unit.';
  byId('equipment-count').textContent = loadState === 'ready'
    ? 'Showing ' + visible.length + ' of ' + equipment.length + ' assets' : '';
  document.querySelectorAll('[data-add-equipment]').forEach((button) => { button.disabled = loadState !== 'ready'; });
}

function openEquipmentEditor(kind, trigger, asset) {
  selectedEquipment = { kind, id: asset?.id, revision: asset?.revision ?? 0 };
  equipmentTrigger = trigger;
  const type = equipmentLabels[kind];
  byId('equipment-editor-title').textContent = asset ? 'Edit ' + asset.assetTag : 'Add ' + type.toLowerCase();
  byId('equipment-editor-meta').textContent = asset?.workstationNumber
    ? type + ' · Assigned to ' + workstationCode(asset.workstationNumber) : type + ' · Unassigned';
  byId('equipment-error').hidden = true;
  equipmentForm.reset();
  for (const field of equipmentForm.querySelectorAll('[data-kind]')) {
    field.hidden = field.dataset.kind !== kind;
    field.firstElementChild.disabled = field.hidden;
  }
  if (asset) {
    for (const [key, value] of Object.entries({ ...asset.details, assetTag: asset.assetTag })) {
      const field = equipmentForm.elements.namedItem(key);
      if (field) field.value = value;
    }
  }
  equipmentDialog.showModal();
  equipmentDialog.querySelector('.editor-body').scrollTop = 0;
}

async function submitEquipment(event) {
  event.preventDefault();
  if (savingEquipment) return;
  const { kind, id, revision } = selectedEquipment;
  const { assetTag, ...details } = Object.fromEntries(new FormData(equipmentForm));
  const button = byId('save-equipment');
  const close = byId('close-equipment');
  const cancel = byId('cancel-equipment');
  savingEquipment = button.disabled = close.disabled = cancel.disabled = true;
  try {
    const response = await demoFetch('/api/equipment' + (id ? '/' + id : ''), {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, revision, assetTag, details }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The equipment could not be saved. Try again.');
    const saved = result.equipment;
    setEquipment([...equipment.filter((asset) => asset.id !== saved.id), saved]
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.assetTag.localeCompare(b.assetTag)));
    renderInventory();
    renderEquipment();
    equipmentDialog.close();
    announce(saved.assetTag + ' saved.');
  } catch (error) {
    const alert = byId('equipment-error');
    alert.textContent = error.message;
    alert.hidden = false;
    equipmentDialog.querySelector('.editor-body').scrollTop = 0;
  } finally {
    savingEquipment = button.disabled = close.disabled = cancel.disabled = false;
  }
}

equipmentSearch.addEventListener('input', renderEquipment);
[equipmentFilter, assignmentFilter].forEach((field) => field.addEventListener('change', renderEquipment));
document.querySelectorAll('[data-add-equipment]').forEach((button) => button.addEventListener('click', () =>
  openEquipmentEditor(button.dataset.addEquipment, button)
));
equipmentForm.addEventListener('submit', submitEquipment);
[byId('close-equipment'), byId('cancel-equipment')].forEach((button) =>
  button.addEventListener('click', () => equipmentDialog.close())
);
equipmentDialog.addEventListener('cancel', (event) => { if (savingEquipment) event.preventDefault(); });
equipmentDialog.addEventListener('close', () => {
  (equipmentTrigger?.isConnected ? equipmentTrigger : equipmentSearch).focus();
});
byId('open-equipment-register').addEventListener('click', () => {
  if (saving) return;
  dialog.close();
  location.hash = 'equipment';
});

selectView();
load();
