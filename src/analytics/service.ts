import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { AnalyticsPersistenceError } from './diagnostic.js';
import { withAnalyticsStore } from './store.js';
import type { AnalyticsSource, Attempt, HistoryFilter } from './domain.js';

export function analyticsDirectory() {
  const override = process.env.JEV_ANALYTICS_DIR;
  if (override) {
    if (!isAbsolute(override)) throw new Error('JEV_ANALYTICS_DIR deve ser absoluto.');
    return override;
  }
  const dataHome = process.env.XDG_DATA_HOME;
  return join(dataHome && isAbsolute(dataHome) ? dataHome : join(homedir(), '.local', 'share'), 'jev-skill-router');
}

function projectRoot(cwd: string) {
  const origin = realpathSync(cwd);
  for (let dir = origin; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dir === dirname(dir)) return origin;
  }
}

export function protectedProjectId(directory: string, cwd: string) {
  const file = join(directory, 'project-hmac.key');
  if (!existsSync(file)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, randomUUID());
    try {
      writeFileSync(temporary, randomBytes(32), { flag: 'wx', mode: 0o600 });
      try {
        linkSync(temporary, file);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    } finally {
      rmSync(temporary, { force: true });
    }
  }
  const info = lstatSync(file);
  if (!info.isFile() || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
    throw new AnalyticsPersistenceError('unsafe-storage', 'A chave de analytics deve ser um arquivo local privado.');
  }
  const secret = readFileSync(file);
  if (secret.length !== 32) throw new AnalyticsPersistenceError('unsafe-storage', 'Chave local de analytics inválida.');
  return createHmac('sha256', secret).update(projectRoot(cwd)).digest('hex');
}

export function analyticsService(directory: string) {
  const marker = join(directory, 'analytics-enabled');
  const db = join(directory, 'analytics.sqlite');
  return {
    enabled: () => existsSync(marker),
    setEnabled(enabled: boolean) {
      if (enabled) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        try {
          writeFileSync(marker, '', { mode: 0o600, flag: 'wx' });
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
        }
      } else rmSync(marker, { force: true });
    },
    async record(id: string, attempt: 1 | 2, source: AnalyticsSource, cwd: string, data: Attempt, recordedAt: string) {
      if (!existsSync(marker)) return 'disabled' as const;
      const projectId = protectedProjectId(directory, cwd);
      const changes = await withAnalyticsStore(db, (store) => store.record({ source, id, attempt, projectId, recordedAt, data }));
      return changes === 0 ? 'already-recorded' as const : 'recorded' as const;
    },
    async history(filter?: HistoryFilter) {
      return existsSync(db) ? groupAttempts(await withAnalyticsStore(db, (store) => store.history(filter), true)) : [];
    },
    async clear() {
      return existsSync(db) ? await withAnalyticsStore(db, (store) => store.clear()) : 0;
    },
  };
}

const metricNames = ['apiCalls', 'inputTokens', 'outputTokens', 'apiLatencyMs', 'routingLatencyMs',
  'estimatedCostUsd', 'cacheHits', 'cacheMisses', 'callsAvoided'] as const;
type MetricName = typeof metricNames[number];
type Metrics = Record<MetricName, number | null>;

function totals(rows: readonly Metrics[]): Metrics {
  return Object.fromEntries(metricNames.map((name) => [
    name, rows.length > 0 && rows.every((row) => row[name] !== null)
      ? rows.reduce((sum, row) => sum + row[name]!, 0)
      : null,
  ])) as Metrics;
}

function groupAttempts(rows: {
  id: string; createdAt: string; projectId: string; source: AnalyticsSource;
  attempt: number; recordedAt: string; data: Attempt;
}[]) {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = grouped.get(row.id);
    if (group) group.push(row);
    else grouped.set(row.id, [row]);
  }
  return [...grouped.values()].map((group) => {
    const { id, createdAt, projectId, source, data } = group.at(-1)!;
    return {
      id, createdAt, projectId, source, latest: data,
      attempts: group.map(({ attempt, recordedAt, data }) => ({ attempt, recordedAt, data })),
      missingAttempts: group[0]?.attempt === 2 ? [1] : [],
      metrics: totals(group.map(({ data }) => data)),
    };
  });
}

type History = ReturnType<typeof groupAttempts>;

export function summarize(history: History) {
  const recordedAttempts = history.flatMap(({ attempts }) => attempts.map(({ data }) => data));
  const knownTotals = Object.fromEntries(metricNames.map((name) => {
    const known = recordedAttempts.flatMap((row) => row[name] === null ? [] : [row[name]]);
    return [name, known.length ? known.reduce((sum, value) => sum + value, 0) : null];
  })) as Metrics;
  return {
    operations: history.length,
    attempts: recordedAttempts.length,
    incompleteOperations: history.filter(({ missingAttempts }) => missingAttempts.length > 0).length,
    fallbacks: history.filter(({ latest }) => latest.fallback !== null).length,
    ...totals(history.map(({ metrics }) => metrics)),
    knownTotals,
  };
}

export function groupStatistics(history: History, groupBy: 'period' | 'project') {
  const groups = new Map<string, History>();
  for (const operation of history) {
    const key = groupBy === 'project' ? operation.projectId : operation.createdAt.slice(0, 10);
    const group = groups.get(key);
    if (group) group.push(operation);
    else groups.set(key, [operation]);
  }
  return [...groups].map(([key, group]) => ({ [groupBy]: key, ...summarize(group) }));
}

export function topSkills(history: History, limit: number) {
  const counts = new Map<string, number>();
  for (const { latest } of history) {
    for (const { name, recommended } of latest.skills) if (recommended) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)).slice(0, limit)
    .map(([name, recommendations]) => ({ name, recommendations }));
}

export function exportCsv(history: History) {
  const fields = ['id', 'createdAt', 'projectId', 'source', 'strategy', 'model', 'policyVersion', 'outcome', 'fallback',
    'diagnostic', 'coverage', 'skills', 'attempts', 'missingAttempts', ...metricNames] as const;
  const quote = (value: unknown) => value == null ? '' : `"${String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll('"', '""')}"`;
  return [fields.join(','), ...history.map(({ latest, metrics, ...operation }) => {
    const row = { ...latest, ...metrics, ...operation };
    return fields.map((field) => quote(row[field])).join(',');
  })].join('\n');
}
