import { createServer } from 'node:http';
import { localDatabase } from './sqlite.mjs';

await import('./build.mjs');
const { default: worker } = await import('../dist/server/index.js');
const env = { DB: localDatabase() };
const portFlag = process.argv.indexOf('--port');
const port = Number((portFlag < 0 ? undefined : process.argv[portFlag + 1]) ?? process.env.PORT ?? 3000);

createServer(async (incoming, outgoing) => {
  const requestHeaders = new Headers(incoming.headers);
  requestHeaders.set('oai-authenticated-user-id', 'local-preview-owner');
  const origin = incoming.headers.origin;
  const host = incoming.headers.host;
  const scheme = origin && new URL(origin).host === host ? new URL(origin).protocol : 'http:';
  const request = new Request(scheme + '//' + host + incoming.url, {
    method: incoming.method,
    headers: requestHeaders,
    ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: incoming, duplex: 'half' } : {}),
  });
  const response = await worker.fetch(request, env);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '0.0.0.0', () => {
  console.log('Local: http://localhost:' + port);
});
