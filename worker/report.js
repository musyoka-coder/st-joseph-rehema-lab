const reportZone = 'Africa/Nairobi';

function reportDate(date, locale = 'en-GB', time = false) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: reportZone, year: 'numeric', month: locale === 'en-CA' ? '2-digit' : 'short', day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).format(date);
}

async function labReport(records, generatedAt, equipmentRegister) {
  const equipmentById = new Map(equipmentRegister.map((asset) => [asset.id, asset]));
  const paired = records.filter(({ monitorId, systemUnitId }) => monitorId && systemUnitId).length;
  const { PDFDocument, rgb } = pdfModule.exports;
  const pdf = await PDFDocument.create();
  pdf.setTitle('Computer Lab Inventory Report');
  pdf.setAuthor('St. Joseph Rehema College');
  pdf.setSubject('Workstation inventory, setup and maintenance');
  pdf.setCreationDate(generatedAt);
  pdf.registerFontkit(fontModule.exports);
  const [regular, bold] = await Promise.all(fontData.map((font) => pdf.embedFont(font, { subset: true })));
  const supported = new Set(regular.getCharacterSet());
  const width = 595.28;
  const height = 841.89;
  const left = 42;
  const inner = width - left * 2;
  const ink = rgb(0.09, 0.17, 0.15);
  const muted = rgb(0.31, 0.38, 0.36);
  const green = rgb(0.04, 0.30, 0.23);
  const mint = rgb(0.88, 0.95, 0.91);
  const wash = rgb(0.95, 0.97, 0.96);
  const border = rgb(0.85, 0.89, 0.87);
  const white = rgb(1, 1, 1);
  let page;
  let cursor;
  let sectionTitle;

  function safe(value) {
    return Array.from(String(value).normalize('NFC').replace(/\r\n?/g, '\n'), (char) => {
      if (char === '\t') return '    ';
      if (char === '\n' || supported.has(char.codePointAt(0))) return char;
      return '[U+' + char.codePointAt(0).toString(16).toUpperCase() + ']';
    }).join('');
  }

  function draw(value, x, y, size = 10, font = regular, color = ink) {
    page.drawText(safe(value), { x, y, size, font, color });
  }
  function rectangle(x, y, w, h, color) {
    page.drawRectangle({ x, y, width: w, height: h, color });
  }
  function rule(y) {
    page.drawLine({ start: { x: left, y }, end: { x: width - left, y }, color: border, thickness: 0.75 });
  }
  function wrap(value, max, size, font) {
    const lines = [];
    for (const paragraph of safe(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const joined = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(joined, size) <= max) { line = joined; continue; }
        if (line) lines.push(line);
        line = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > max) { lines.push(line); line = ''; }
          line += char;
        }
      }
      lines.push(line);
    }
    return lines;
  }
  function cell(value, max, size, font = regular) {
    const full = safe(value);
    if (font.widthOfTextAtSize(full, size) <= max) return full;
    let shortened = full;
    while (font.widthOfTextAtSize(shortened + '...', size) > max) shortened = shortened.slice(0, -1);
    return shortened + '...';
  }
  function addPage(title, cover = false) {
    sectionTitle = title;
    page = pdf.addPage([width, height]);
    const bannerHeight = cover ? 124 : 99;
    rectangle(0, height - bannerHeight, width, bannerHeight, green);
    draw('ST. JOSEPH REHEMA COLLEGE', left, height - 41, 10, bold, mint);
    draw(title, left, height - 70, cover ? 25 : 19, bold, white);
    if (cover) draw('Generated ' + reportDate(generatedAt, 'en-GB', true) + ' EAT  |  Internal use', left, height - 94, 10, regular, mint);
    cursor = height - bannerHeight - 34;
  }

  addPage('Computer Lab Inventory Report', true);
  const summary = totals(records);
  const metrics = [
    ['Workstations', summary.stations], ['Ready', summary.ready],
    ['In progress', summary.inProgress], ['Needs attention', summary.attention],
  ];
  const tile = (inner - 30) / 4;
  for (const [index, [label, value]] of metrics.entries()) {
    const x = left + index * (tile + 10);
    rectangle(x, cursor - 62, tile, 62, wash);
    draw(String(value), x + 12, cursor - 29, 22, bold, green);
    draw(label, x + 12, cursor - 47, 9, regular, muted);
  }
  cursor -= 84;
  draw('Needs attention includes blocked setup, repair and out-of-service workstations.', left, cursor, 9, regular, muted);
  cursor -= 16;
  draw(paired + ' fully paired  |  ' + equipmentRegister.length + ' registered equipment assets', left, cursor, 9, bold, green);
  cursor -= 29;
  draw('Workstation register', left, cursor, 15, bold);
  cursor -= 33;
  const columns = [left + 9, left + 83, left + 269, left + 385];
  rectangle(left, cursor - 8, inner, 25, green);
  ['Workstation', 'Equipment / model', 'Condition', 'Setup status'].forEach((label, index) =>
    draw(label, columns[index], cursor, 9, bold, white)
  );
  cursor -= 24;
  records.forEach(({ code, details, monitorId, systemUnitId }, index) => {
    if (index % 2 === 0) rectangle(left, cursor - 7, inner, 24, wash);
    draw(code, columns[0], cursor, 9, bold);
    const linked = [systemUnitId, monitorId].map((id) => equipmentById.get(id)?.assetTag).filter(Boolean);
    const label = linked.join(' / ') || details.model;
    draw(cell(label || 'Not recorded', 173, 9), columns[1], cursor, 9, regular, label ? ink : muted);
    draw(details.condition, columns[2], cursor, 9);
    draw(details.setup, columns[3], cursor, 9);
    cursor -= 24;
  });
  rule(cursor + 17);
  const edited = records.filter(({ revision }) => revision > 0);
  cursor -= 4;
  draw(edited.length
    ? 'Workstation details and maintenance follow on the next pages.'
    : equipmentRegister.length ? 'The equipment register follows on the next pages.'
      : 'Equipment and maintenance details will appear after records are saved.', left, cursor, 9, regular, muted);

  const labels = {
    model: 'Make / model', serial: 'Serial number', assetTag: 'Asset tag', processor: 'Processor',
    memory: 'RAM', storage: 'Storage', operatingSystem: 'Operating system', monitor: 'Monitor',
    keyboard: 'Keyboard', mouse: 'Mouse', network: 'Network', power: 'Power / UPS',
  };

  function startSection(record) {
    if (cursor < 200) addPage('Workstation Details');
    rectangle(left, cursor - 11, inner, 29, mint);
    draw(record.code, left + 10, cursor, 11, bold, green);
    draw(record.details.condition + '  /  ' + record.details.setup, left + 87, cursor, 9, regular, green);
    cursor -= 28;
    draw('Updated ' + reportDate(new Date(record.updatedAt), 'en-GB', true) + ' EAT', left + 10, cursor, 8, regular, muted);
    cursor -= 18;
  }
  function block(value, context, { size = 10, font = regular, color = ink, x = left + 10 } = {}) {
    for (const line of wrap(value, width - left - x - 7, size, font)) {
      if (cursor < 76) {
        addPage(sectionTitle);
        draw(context + ' continued', left + 10, cursor, 11, bold, green);
        cursor -= 21;
      }
      draw(line, x, cursor, size, font, color);
      cursor -= 14;
    }
  }

  if (edited.length) addPage('Workstation Details');
  for (const record of edited) {
    startSection(record);
    const savedFields = Object.entries(labels).filter(([key]) => record.details[key]);
    const assignments = [['Assigned monitor', record.monitorId], ['Assigned system unit', record.systemUnitId]];
    for (const [label, id] of assignments) {
      const asset = equipmentById.get(id);
      if (asset) block(label + '  |  ' + asset.assetTag + ' / ' + asset.details.model, record.code);
    }
    for (const [key, label] of savedFields) block(label + '  |  ' + record.details[key], record.code);
    if (!savedFields.length && !record.monitorId && !record.systemUnitId) {
      block('Equipment details not recorded.', record.code, { color: muted });
    }
    if (record.notes.length) {
      cursor -= 5;
      block('Maintenance history', record.code, { font: bold, color: green });
      for (const note of record.notes) {
        if (cursor < 103) {
          addPage('Workstation Details');
          draw(record.code + ' maintenance history continued', left + 10, cursor, 11, bold, green);
          cursor -= 21;
        }
        block(note.category + '  |  ' + reportDate(new Date(note.createdAt), 'en-GB', true) + ' EAT', record.code, {
          size: 9, font: bold, color: muted,
        });
        block(note.text, record.code, { x: left + 19 });
        cursor -= 6;
      }
    }
    cursor -= 17;
  }

  if (equipmentRegister.length) addPage('Equipment Register');
  const assetLabels = {
    serial: 'Serial number', displaySize: 'Screen size', ports: 'Video ports', processor: 'Processor',
    memory: 'RAM', storage: 'Storage', operatingSystem: 'Operating system', remarks: 'Notes',
  };
  for (const asset of equipmentRegister) {
    if (cursor < 150) addPage('Equipment Register');
    rectangle(left, cursor - 11, inner, 29, mint);
    const kind = asset.kind === 'monitor' ? 'Monitor' : 'System unit';
    draw(cell(asset.assetTag, 350, 11, bold), left + 10, cursor, 11, bold, green);
    draw(kind, left + 382, cursor, 9, regular, green);
    cursor -= 28;
    const assignment = asset.workstationNumber
      ? 'Assigned to PC-' + String(asset.workstationNumber).padStart(2, '0') : 'Unassigned';
    block(asset.details.model + '  |  ' + asset.details.condition + '  |  ' + assignment, kind);
    for (const [key, label] of Object.entries(assetLabels)) {
      if (asset.details[key]) block(label + '  |  ' + asset.details[key], kind);
    }
    cursor -= 17;
  }

  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    page = item;
    rule(58);
    draw('St. Joseph Rehema College  /  Computer Lab', left, 41, 8, regular, muted);
    const counter = 'Page ' + (index + 1) + ' of ' + pages.length;
    draw(counter, width - left - regular.widthOfTextAtSize(counter, 8), 41, 8, regular, muted);
  });
  return pdf.save();
}
