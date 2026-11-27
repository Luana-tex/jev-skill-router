import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attempt } from '../src/analytics/domain.js';
import { operationRecorder } from '../src/analytics/record.js';
import { analyticsService, exportCsv, groupStatistics, protectedProjectId, summarize, topSkills } from '../src/analytics/service.js';
import { withAnalyticsStore } from '../src/analytics/store.js';

let directory: string;
let service: ReturnType<typeof analyticsService>;

const base: Attempt = {
  strategy: 'adaptive-coverage', policyVersion: 'adaptive-4.3', model: 'jev-test', requestedModel: 'jev-latest',
  outcome: 'skills-selected', fallback: null, diagnostic: null,
  skills: [{ name: 'sites:sites', evaluated: true, recommended: true, used: null, score: 0.95, reason: 'selected', coveredBy: null }],
  coverage: { covered: [0], uncovered: [1], estimatedContextTokens: 500 },
  apiCalls: 1, inputTokens: 30, outputTokens: 5, apiLatencyMs: 40, routingLatencyMs: 50,
  estimatedCostUsd: 0.001, cacheHits: 0, cacheMisses: 1, callsAvoided: 0,
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jev-analytics-test-'));
  service = analyticsService(directory);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('analytics SQLite', () => {
  it('cria e reaplica migrations, preserva o histórico e respeita opt-in', async () => {
    const id = randomUUID();
    const when = '2026-11-26T23:00:00.000Z';
    await service.record(id, 1, 'cli', directory, base, when);
    expect(await service.history()).toEqual([]);
    service.setEnabled(true);
    await service.record(id, 1, 'cli', directory, base, when);
    const database = new DatabaseSync(join(directory, 'analytics.sqlite'));
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    database.close();
    expect((await service.history())[0]).toMatchObject({ id, latest: base });
    service.setEnabled(false);
    await service.record(randomUUID(), 1, 'cli', directory, base, when);
    expect(await service.history()).toHaveLength(1);
  });

  it('correlaciona retries, ignora tentativas duplicadas e mantém valores desconhecidos', async () => {
    service.setEnabled(true);
    const id = randomUUID();
    const before = '2026-11-26T23:00:00.000Z';
    const after = '2026-11-26T23:00:01.000Z';
    await service.record(id, 1, 'codex', directory, {
      ...base, fallback: 'judgment-failed', inputTokens: null, outputTokens: null, estimatedCostUsd: null,
      skills: [], diagnostic: { code: 'network-unavailable', httpStatus: null },
    }, before);
    await service.record(id, 2, 'codex', directory, base, after);
    await service.record(id, 2, 'codex', directory, base, after);
    const history = await service.history();
    expect(summarize(history)).toMatchObject({ operations: 1, attempts: 2, fallbacks: 0, apiCalls: 2, inputTokens: null, estimatedCostUsd: null });
    expect(history[0]?.latest.skills[0]?.used).toBeNull();
    expect(topSkills(history, 10)).toEqual([{ name: 'sites:sites', recommendations: 1 }]);
    expect(groupStatistics(history, 'period')[0]).toMatchObject({ period: '2026-11-26', operations: 1 });
    expect(groupStatistics(history, 'project')[0]).toMatchObject({ project: history[0]?.projectId });
    expect(await service.history({ since: after })).toEqual([]);
    expect(await service.history({ until: before })).toEqual([]);
    expect(await service.history({ projectId: 'a'.repeat(64) })).toEqual([]);
  });

  it('usa HMAC por instalação e agrupa subdiretórios do mesmo projeto', async () => {
    const root = join(directory, 'project');
    const sub = join(root, 'sub');
    const data = join(directory, 'data');
    await mkdir(sub, { recursive: true });
    await mkdir(join(root, '.git'));
    const rootId = protectedProjectId(data, root);
    expect(rootId).toMatch(/^[a-f0-9]{64}$/);
    expect(protectedProjectId(data, sub)).toBe(rootId);
    expect(protectedProjectId(join(directory, 'other-data'), root)).not.toBe(rootId);
    expect(protectedProjectId(data, directory)).not.toBe(rootId);
  });

  it('exporta apenas dados autorizados e limpa o histórico com integridade referencial', async () => {
    service.setEnabled(true);
    const payload = { ...base, prompt: 'segredo do prompt', path: directory, credential: 'segredo da chave' };
    await service.record(randomUUID(), 1, 'cli', directory, payload, '2026-11-26T23:00:00.000Z');
    const history = await service.history();
    const csv = exportCsv(history);
    for (const value of [JSON.stringify(history), csv, await readFile(join(directory, 'analytics.sqlite'), 'utf8')]) {
      expect(value).not.toContain('segredo');
      expect(value).not.toContain(directory);
    }
    expect(csv).toContain('sites:sites');
    expect(await service.clear()).toBe(1);
    expect(await service.history()).toEqual([]);
    const db = new DatabaseSync(join(directory, 'analytics.sqlite'));
    expect(db.prepare('SELECT count(*) AS n FROM attempts').get()?.n).toBe(0);
    db.close();
  });

  it('aguarda escritor concorrente e preserva ambas as gravações', async () => {
    const path = join(directory, 'analytics.sqlite');
    await withAnalyticsStore(path, () => undefined);
    const other = spawn(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT INTO operations VALUES (?, ?, ?, ?)').run(
        '11111111-1111-4111-8111-111111111111', '2026-11-26T23:00:00.000Z', 'a'.repeat(64), 'cli');
      console.log('locked');
      setTimeout(() => { db.exec('COMMIT'); db.close(); }, 300);
    `, path], { stdio: ['ignore', 'pipe', 'ignore'] });
    const exited = once(other, 'exit');
    const pipe = createInterface({ input: other.stdout });
    try {
      expect((await once(pipe, 'line'))[0]).toBe('locked');
      const id = randomUUID();
      await withAnalyticsStore(path, (store) => store.record({
        id, source: 'cli', projectId: 'b'.repeat(64), recordedAt: '2026-11-26T23:00:00.000Z', attempt: 1, data: base,
      }));
      expect((await exited)[0]).toBe(0);
      const db = new DatabaseSync(path);
      expect(db.prepare('SELECT count(*) AS n FROM operations').get()?.n).toBe(2);
      db.close();
    } finally {
      pipe.close();
      other.kill();
    }
  });

  it('registra julgamento e recomendação sem inferir uso', async () => {
    service.setEnabled(true);
    vi.stubEnv('JEV_ANALYTICS_DIR', directory);
    const recorder = operationRecorder('codex');
    recorder.onEvaluated?.('layout', 0.92);
    recorder.onEvaluated?.('other', 0.3);
    recorder.onDecision?.({ name: 'other', decision: 'below-relevance', relevance: 0.3 });
    recorder.recordBatch({
      phase: 'relevance', questions: 2, latencyMs: 12, status: 200, model: 'jev-test',
      usage: { input_tokens: 20, output_tokens: 4 },
    });
    await recorder.finish({
      reason: 'needs-judgment', status: 'advisory', outcome: 'skills-selected', cache: 'miss',
      recommendations: [{ name: 'layout', relevance: 0.92 }],
    }, { model: 'jev-latest', inputUsdPerMillion: 1, outputUsdPerMillion: 0 });
    expect((await service.history())[0]).toMatchObject({
      latest: {
        model: 'jev-test', requestedModel: 'jev-latest', cacheMisses: 1, estimatedCostUsd: 0.00002,
        skills: [
          { name: 'layout', evaluated: true, recommended: true, used: null, score: 0.92 },
          { name: 'other', evaluated: true, recommended: false, used: null, reason: 'below-relevance' },
        ],
      },
    });
  });

  it('rejeita schema de versão futura sem sobrescrevê-lo', async () => {
    const path = join(directory, 'analytics.sqlite');
    await withAnalyticsStore(path, () => undefined);
    const db = new DatabaseSync(path);
    db.exec('PRAGMA user_version = 99');
    await expect(withAnalyticsStore(path, () => undefined)).rejects.toThrow('incompatível');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(99);
    db.close();
  });

  it('falha de persistência é isolada e simulações podem desativar o registro', async () => {
    service.setEnabled(true);
    vi.stubEnv('JEV_ANALYTICS_DIR', directory);
    vi.stubEnv('JEV_ANALYTICS', 'off');
    await operationRecorder('cli').finish({ reason: 'mechanical-task' });
    expect(await service.history()).toEqual([]);
    vi.stubEnv('JEV_ANALYTICS', '');
    await writeFile(join(directory, 'analytics.sqlite'), 'invalid sqlite', { mode: 0o600 });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(operationRecorder('cli').finish({ reason: 'mechanical-task' })).resolves.toMatchObject({
      status: 'failed', diagnostic: { code: 'database-invalid' },
    });
    expect(error).toHaveBeenCalledWith('Não foi possível registrar a operação no analytics local.');
  });
});
