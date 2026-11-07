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
