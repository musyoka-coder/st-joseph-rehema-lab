import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import { localDatabase } from './sqlite.mjs';

await import('./build.mjs');
const { default: worker } = await import('../dist/server/index.js');
const { PDFDocument } = createRequire(import.meta.url)('pdf-lib');
const origin = 'https://rehema.test';

test('private register persists changes and generates a complete A4 report', async () => {
  const env = { DB: localDatabase() };
  function request(path, { identity = true, method = 'GET', body, from = origin } = {}) {
    const headers = new Headers();
    if (identity) headers.set('oai-authenticated-user-id', 'test-owner');
    if (body) {
      headers.set('Origin', from);
      headers.set('Content-Type', 'application/json');
    }
    return worker.fetch(new Request(origin + path, { method, headers, body: body && JSON.stringify(body) }), env);
  }
  for (const path of ['/', '/api/inventory', '/api/report.pdf']) {
    assert.equal((await request(path, { identity: false })).status, 401);
  }
  const { records } = await (await request('/api/inventory')).json();
  assert.equal(records.length, 13);
  assert.equal(records[0].code, 'PC-01');
  assert.equal(records[12].code, 'PC-13');
  assert.ok(records.every(({ details, revision }) =>
    details.model === '' && details.condition === 'Not assessed' && details.setup === 'Not started' && revision === 0
  ));
  const blank = new Uint8Array(await (await request('/api/report.pdf')).arrayBuffer());
  assert.equal((await PDFDocument.load(blank)).getPageCount(), 1);

  const path = '/api/inventory/1';
  const equipment = {
    revision: 0,
    details: { ...records[0].details, model: 'Dell OptiPlex 5070', assetTag: 'SJRC-001', storage: '256 GB SSD',
      operatingSystem: 'Windows 11', network: 'Ethernet tested', condition: 'Good', setup: 'Ready' },
    note: { category: 'Inspection', text: 'Ethernet and display verified.\nKeyboard tested.' },
  };
  assert.equal((await request(path, { method: 'PUT', body: equipment, from: 'https://other.test' })).status, 403);
  assert.equal((await request(path, { method: 'PUT', body: equipment, identity: false })).status, 401);
  assert.equal((await request(path, { method: 'PUT', body: { ...equipment, details: { ...equipment.details, condition: 'Invalid' } } })).status, 400);
  const concurrent = await Promise.all([1, 2].map(() => request(path, { method: 'PUT', body: equipment })));
  assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 409]);
  const { record } = await concurrent.find(({ ok }) => ok).json();
  assert.equal(record.revision, 1);
  assert.equal(record.notes.length, 1);
  const changed = {
    revision: record.revision,
    details: { ...record.details, memory: '8 GB' },
    note: { category: 'Follow-up', text: 'Schedule cable labeling.' },
  };
  assert.equal((await request(path, { method: 'PUT', body: changed })).status, 200);
  const { records: saved } = await (await request('/api/inventory')).json();
  assert.equal(saved[0].details.assetTag, 'SJRC-001');
  assert.equal(saved[0].details.memory, '8 GB');
  assert.equal(saved[0].notes.length, 2);
  assert.equal(saved[12].revision, 0);

  const response = await request('/api/report.pdf');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/pdf');
  assert.match(response.headers.get('Content-Disposition'), /attachment; filename="Rehema-Computer-Lab-\d{4}-\d{2}-\d{2}\.pdf"/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const report = await PDFDocument.load(bytes);
  assert.equal(report.getTitle(), 'Computer Lab Inventory Report');
  assert.equal(report.getPageCount(), 2);
  assert.equal(Math.round(report.getPage(0).getWidth()), 595);
  assert.equal(Math.round(report.getPage(0).getHeight()), 842);
  if (process.env.REHEMA_QA_PDF) await writeFile(process.env.REHEMA_QA_PDF, bytes);

  const long = { revision: 2, details: saved[0].details,
    note: { category: 'Repair', text: ('Long maintenance entry with an asset reference.\n').repeat(40) + 'Final maintenance line.' } };
  assert.equal((await request(path, { method: 'PUT', body: long })).status, 200);
  const extended = new Uint8Array(await (await request('/api/report.pdf')).arrayBuffer());
  assert.ok((await PDFDocument.load(extended)).getPageCount() > 2);
  if (process.env.REHEMA_QA_PDF) await writeFile(process.env.REHEMA_QA_PDF.replace('.pdf', '-overflow.pdf'), extended);
});

test('equipment is registered separately and paired without duplicate assignments', async () => {
  const env = { DB: localDatabase() };
  const send = (path, method = 'GET', body) => worker.fetch(new Request(origin + path, {
    method,
    headers: { 'oai-authenticated-user-id': 'test-owner', 'Origin': origin, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }), env);
  const read = async () => (await send('/api/inventory')).json();
  const asset = (kind, assetTag, model) => ({ kind, assetTag, revision: 0, details: { model, condition: 'Good' } });
  const monitorInput = asset('monitor', 'MON-01', 'Dell P2219H');
  const unitInput = asset('system-unit', 'UNIT-01', 'HP ProDesk 400');
  const addedMonitor = await send('/api/equipment', 'POST', monitorInput);
  const addedUnit = await send('/api/equipment', 'POST', unitInput);
  assert.equal(addedMonitor.status, 201);
  assert.equal(addedUnit.status, 201);
  const { equipment: monitor } = await addedMonitor.json();
  const { equipment: unit } = await addedUnit.json();
  assert.equal((await send('/api/equipment', 'POST', { ...monitorInput, assetTag: 'mon-01' })).status, 409);
  const initial = await read();
  assert.equal(initial.records.length, 13);
  assert.ok(initial.equipment.every((item) => item.workstationNumber === null));

  const details = { ...initial.records[0].details, monitor: 'Legacy monitor note' };
  const edit = { details, revision: 0, monitorId: monitor.id, systemUnitId: unit.id };
  assert.equal((await send('/api/inventory/1', 'PUT', { ...edit, monitorId: unit.id })).status, 400);
  const competing = await Promise.all([1, 2].map((number) => send('/api/inventory/' + number, 'PUT', edit)));
  assert.deepEqual(competing.map(({ status }) => status).sort(), [200, 409]);
  const { record: assigned } = await competing.find(({ ok }) => ok).json();
  const after = await read();
  assert.ok(after.equipment.every((item) => item.workstationNumber === assigned.number));
  assert.equal(after.records[assigned.number - 1].details.monitor, 'Legacy monitor note');

  const editedMonitor = { ...monitorInput, revision: monitor.revision,
    details: { ...monitorInput.details, displaySize: '22 inches', ports: 'DisplayPort, HDMI' } };
  const changed = await send('/api/equipment/' + monitor.id, 'PUT', editedMonitor);
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).equipment.workstationNumber, assigned.number);
  assert.equal((await send('/api/equipment/' + monitor.id, 'PUT', editedMonitor)).status, 409);
  const linkedReport = await send('/api/report.pdf');
  assert.equal(linkedReport.status, 200);
  const bytes = new Uint8Array(await linkedReport.arrayBuffer());
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  if (process.env.REHEMA_QA_PDF) await writeFile(process.env.REHEMA_QA_PDF.replace('.pdf', '-equipment.pdf'), bytes);

  const updated = await send('/api/inventory/' + assigned.number, 'PUT',
    { revision: assigned.revision, details: { ...details, network: 'Verified' } });
  assert.equal(updated.status, 200);
  const { record: preserved } = await updated.json();
  assert.equal(preserved.monitorId, monitor.id);
  assert.equal(preserved.systemUnitId, unit.id);
  assert.equal((await send('/api/inventory/' + assigned.number, 'PUT',
    { revision: preserved.revision, details: preserved.details, monitorId: null, systemUnitId: null })).status, 200);
  assert.ok((await read()).equipment.every((item) => item.workstationNumber === null));
});
