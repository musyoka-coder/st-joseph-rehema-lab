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
