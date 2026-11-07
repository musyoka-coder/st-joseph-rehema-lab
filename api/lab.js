import { createHash, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import app from '../dist/server/index.js';

let database;

function databaseConnection() {
  if (database) return database;
  const sql = postgres(process.env.LAB_DATABASE_URL, {
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 8,
    ssl: { rejectUnauthorized: true },
  });

  function execute(query, values) {
    let index = 0;
    const statement = query.replaceAll('?', () => '$' + ++index);
    return sql.begin(async (transaction) => {
      await transaction.unsafe('SET LOCAL search_path TO rehema_lab, pg_catalog');
      const result = await transaction.unsafe(statement, values);
      return { rows: Array.from(result), count: result.count };
    });
  }

  database = {
    prepare(query) {
      const methods = (values) => ({
        all: async () => ({ results: (await execute(query, values)).rows }),
        first: async () => (await execute(query, values)).rows[0] ?? null,
        run: async () => ({ meta: { changes: (await execute(query, values)).count } }),
      });
      return { ...methods([]), bind: (...values) => methods(values) };
    },
  };
  return database;
}

const digest = (value) => createHash('sha256').update(value).digest();
const protectionHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

export default {
  async fetch(request) {
    const secret = process.env.LAB_ACCESS_PASSWORD;
    if (!secret || secret.length < 20 || !process.env.LAB_DATABASE_URL) {
      return new Response('Private lab setup is incomplete.', { status: 503, headers: protectionHeaders });
    }
    const authorization = request.headers.get('Authorization') ?? '';
    const expected = 'Basic ' + Buffer.from('owner:' + secret).toString('base64');
    if (!timingSafeEqual(digest(authorization), digest(expected))) {
      return new Response('Sign in to open the private lab.', {
        status: 401,
        headers: { ...protectionHeaders, 'WWW-Authenticate': 'Basic realm="Rehema Lab", charset="UTF-8"' },
      });
    }

    const url = new URL(request.url);
    if (url.pathname === '/api/lab') {
      const rewritten = url.searchParams.get('labPath');
      if (rewritten?.startsWith('/') && !rewritten.startsWith('//')) url.pathname = rewritten;
    }
    url.search = '';
    const trustedHeaders = new Headers(request.headers);
    trustedHeaders.delete('Authorization');
    trustedHeaders.set('oai-authenticated-user-id', 'rehema-lab-owner');
    const forwarded = new Request(url, {
      method: request.method,
      headers: trustedHeaders,
      ...(request.body ? { body: request.body, duplex: 'half' } : {}),
    });
    return app.fetch(forwarded, { DB: databaseConnection() });
  },
};
