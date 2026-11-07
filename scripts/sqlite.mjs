import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const directory = new URL('../drizzle/', import.meta.url);
const { entries } = JSON.parse(readFileSync(new URL('meta/_journal.json', directory), 'utf8'));

export function localDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const { tag } of entries) {
    database.exec(readFileSync(new URL(tag + '.sql', directory), 'utf8'));
  }
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      const methods = (values) => ({
        all: async () => ({ results: statement.all(...values) }),
        first: async () => statement.get(...values) ?? null,
        run: async () => ({ meta: statement.run(...values) }),
      });
      return { ...methods([]), bind: (...values) => methods(values) };
    },
  };
}
