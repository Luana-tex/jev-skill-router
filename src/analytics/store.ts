import { constants, closeSync, fstatSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { AnalyticsPersistenceError } from './diagnostic.js';
import { attemptSchema, operationIdSchema } from './domain.js';
import type { AnalyticsSource, AttemptEvent, HistoryFilter } from './domain.js';

const migrations = [
  `
    CREATE TABLE operations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('cli', 'codex'))
    ) STRICT;
    CREATE TABLE attempts (
      operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL CHECK(attempt IN (1, 2)),
      recorded_at TEXT NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload)),
      PRIMARY KEY(operation_id, attempt)
    ) STRICT;
    CREATE INDEX operations_time ON operations(created_at, id);
    CREATE INDEX operations_project_time ON operations(project_id, created_at, id);
  `,
];

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function withAnalyticsStore<T>(
  path: string,
  work: (store: ReturnType<typeof analyticsStore>) => T,
  readOnly = false,
): Promise<T> {
  const { DatabaseSync } = await import('node:sqlite');
  if (!readOnly) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const flags = readOnly ? constants.O_RDONLY : constants.O_CREAT | constants.O_RDWR;
  const file = openSync(path, flags | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const info = fstatSync(file);
    if (!info.isFile() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
      throw new AnalyticsPersistenceError('unsafe-storage', 'O banco de analytics deve ser um arquivo local privado.');
    }
  } finally {
    closeSync(file);
  }
  const db = new DatabaseSync(path, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 1500; PRAGMA foreign_keys = ON;');
    function schemaVersion() {
      const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
      if (!Number.isInteger(version) || version > migrations.length) throw new AnalyticsPersistenceError('schema-incompatible', 'Versão do banco de analytics incompatível.');
      return version;
    }
    if (readOnly) {
      schemaVersion();
      return work(analyticsStore(db));
    }
    db.exec('PRAGMA secure_delete = ON');
    transaction(db, () => {
      const version = schemaVersion();
      for (let index = version; index < migrations.length; index++) {
        db.exec(migrations[index]!);
        db.exec(`PRAGMA user_version = ${index + 1}`);
      }
    });
    return work(analyticsStore(db));
  } finally {
    db.close();
  }
}

function analyticsStore(db: DatabaseSync) {
  return {
    record(event: AttemptEvent) {
      const id = operationIdSchema.parse(event.id);
      const payload = JSON.stringify(attemptSchema.parse(event.data));
      if (!/^[a-f0-9]{64}$/.test(event.projectId)) throw new Error('Identificador de projeto inválido.');
      return transaction(db, () => {
        db.prepare(`INSERT INTO operations VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET created_at = min(operations.created_at, excluded.created_at)`)
          .run(id, event.recordedAt, event.projectId, event.source);
        const identity = db.prepare('SELECT project_id, source FROM operations WHERE id = ?').get(id);
        if (identity?.project_id !== event.projectId || identity.source !== event.source) {
          throw new AnalyticsPersistenceError('project-mismatch', 'A tentativa pertence a outra operação.');
        }
        return db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?) ON CONFLICT(operation_id, attempt) DO NOTHING')
          .run(id, event.attempt, event.recordedAt, payload).changes;
      });
    },
    history(filter: HistoryFilter = {}) {
      if (db.prepare('PRAGMA user_version').get()?.user_version === 0) return [];
      const rows = db.prepare(`
        WITH selected AS (
          SELECT * FROM operations
          WHERE (? IS NULL OR created_at >= ?)
            AND (? IS NULL OR created_at < ?)
            AND (? IS NULL OR project_id = ?)
          ORDER BY created_at DESC, id DESC LIMIT ?
        )
        SELECT selected.*, attempts.attempt, attempts.recorded_at, attempts.payload
        FROM selected JOIN attempts ON attempts.operation_id = selected.id
        ORDER BY selected.created_at DESC, selected.id DESC, attempts.attempt
      `).all(filter.since ?? null, filter.since ?? null, filter.until ?? null, filter.until ?? null,
        filter.projectId ?? null, filter.projectId ?? null, filter.limit ?? -1);
      return rows.map((row) => ({
        id: String(row.id),
        createdAt: String(row.created_at),
        projectId: String(row.project_id),
        source: row.source as AnalyticsSource,
        attempt: Number(row.attempt),
        recordedAt: String(row.recorded_at),
        data: attemptSchema.parse(JSON.parse(String(row.payload))),
      }));
    },
    clear() {
      return db.prepare('DELETE FROM operations').run().changes;
    },
  };
}
