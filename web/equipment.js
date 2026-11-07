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
    const response = await fetch('/api/equipment' + (id ? '/' + id : ''), {
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
