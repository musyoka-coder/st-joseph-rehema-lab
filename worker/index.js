const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers });
}

function textResponse(message, status) {
  return new Response(message, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!request.headers.get('oai-authenticated-user-id')) return textResponse('Sign in to open the private lab.', 401);

  if (request.method === 'GET' && Object.hasOwn(assets, path)) {
    const asset = assets[path];
    return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type } });
  }
  if (request.method === 'GET' && path === '/api/inventory') {
    return json(await inventorySnapshot(env.DB));
  }
  if (request.method === 'GET' && path === '/api/report.pdf') {
    const date = new Date();
    const { records, equipment } = await inventorySnapshot(env.DB);
    const report = await labReport(records, date, equipment);
    const dateStamp = reportDate(date, 'en-CA');
    return new Response(report, {
      headers: {
        ...headers,
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Rehema-Computer-Lab-' + dateStamp + '.pdf"',
      },
    });
  }
  const workstation = /^\/api\/inventory\/(\d{1,2})$/.exec(path);
  const equipment = /^\/api\/equipment(?:\/([a-f0-9-]+))?$/.exec(path);
  const stationEdit = request.method === 'PUT' && workstation;
  const assetCreate = request.method === 'POST' && equipment && !equipment[1];
  const assetEdit = request.method === 'PUT' && equipment && equipmentIdPattern.test(equipment[1] || '');
  if (stationEdit || assetCreate || assetEdit) {
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'The request must come from this site.' }, 403);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      return json({ error: 'Send a JSON record.' }, 415);
    }
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: 'The record is too large.' }, 413);
    let input;
    try { input = JSON.parse(raw); }
    catch { return json({ error: 'The record could not be read.' }, 400); }
    if (stationEdit) {
      const number = Number(workstation[1]);
      if (number < 1 || number > stationCount) return json({ error: 'Workstation not found.' }, 404);
      const edit = parseEdit(input);
      if (edit.error) return json({ error: edit.error }, 400);
      const result = await saveStation(env.DB, number, edit);
      if (result.conflict) return json({ error: typeof result.conflict === 'string' ? result.conflict
        : 'This record changed in another tab or device. Reload the saved record before applying your edits.' }, 409);
      if (result.error) return json({ error: result.error }, 400);
      return json(result);
    }
    const edit = parseEquipment(input);
    if (edit.error) return json({ error: edit.error }, 400);
    if (assetCreate && edit.revision !== 0) return json({ error: 'Start a new equipment record.' }, 400);
    const result = await saveEquipment(env.DB, equipment[1], edit);
    if (result.conflict) return json({ error: result.conflict }, 409);
    return json(result, assetCreate ? 201 : 200);
  }
  return textResponse('Page not found.', 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error('Lab request failed', new URL(request.url).pathname, error);
      return json({ error: 'The lab workspace is temporarily unavailable. Try again.' }, 500);
    }
  },
};
