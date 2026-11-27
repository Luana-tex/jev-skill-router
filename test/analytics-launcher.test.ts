import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { persistenceDiagnostic } from '../src/analytics/diagnostic.js';

it('classifica negações do sistema e do SQLite sem retornar a mensagem original', () => {
  expect(persistenceDiagnostic({ code: 'EPERM', message: '/private/key' })).toBe('write-denied');
  expect(persistenceDiagnostic({ code: 'ERR_SQLITE_ERROR', errcode: 520 })).toBe('write-denied');
});

it('integra launcher, roteamento e SQLite com métricas conhecidas e recuperação idempotente', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-analytics-launcher-'));
  const repository = process.cwd();
  try {
    const data = join(root, 'data');
    const project = join(root, 'project');
    const launcher = join(root, 'codex', 'jev-skill-router', 'scripts', 'recommend.mjs');
    mkdirSync(project, { recursive: true });
    mkdirSync(join(root, 'codex', 'jev-skill-router', 'scripts'), { recursive: true });
    copyFileSync(join(repository, 'codex', 'jev-skill-router', 'scripts', 'recommend.mjs'), launcher);
    symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    execFileSync(process.execPath, [join(repository, 'node_modules', 'typescript', 'bin', 'tsc'), '--outDir', join(root, 'dist')], { cwd: repository });

    const stub = `globalThis.fetch = async (_url, init) => {
      if (process.env.JEV_TEST_TRANSPORT === 'forbidden') process.exit(99);
      if (process.env.JEV_TEST_TRANSPORT === 'offline') throw new Error('private transport detail');
      const answers = Object.fromEntries(Object.keys(JSON.parse(init.body).questions)
        .map((id) => [id, {type:'noul', noul:0.98}]));
      return Response.json({model:'jev-test',usage:{input_tokens:9106,output_tokens:2064},answers});
    }`;
    const task = 'Review the layout of a private fixture.';
    const input = {
      task, needs: ['Visual layout'],
      availableSkills: [{ name: 'layout', description: 'Review layouts.', path: join(project, 'layout', 'SKILL.md') }],
    };

    function run(args: string[], dataInput?: unknown, mode = 'forbidden') {
      const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(stub), launcher, ...args], {
        cwd: project,
        input: dataInput === undefined ? undefined : JSON.stringify(dataInput),
        encoding: 'utf8',
        env: { ...process.env, XDG_CACHE_HOME: join(root, 'cache'), JEV_ANALYTICS_DIR: data, JEV_ANALYTICS: '',
          TYPESAFE_API_KEY: 'fake-test-secret', JEV_SKILL_ROUTER_DISABLED: '', JEV_TEST_TRANSPORT: mode },
      });
      expect(child.status, child.stderr).toBe(0);
      return JSON.parse(child.stdout);
    }

    expect(run(['analytics', 'enable'])).toMatchObject({ enabled: true });
    const cold = run(['--after-network-approval', '--operation-id', randomUUID(), '--metrics'], input, 'success');
    expect(cold).toMatchObject({ status: 'advisory', cache: 'miss', analytics: { status: 'recorded' }, callsAvoided: 0 });
    expect(run(['analytics', 'summary'])).toMatchObject({
      operations: 1, attempts: 1, incompleteOperations: 1, inputTokens: 9106, outputTokens: 2064, apiCalls: 1,
    });
    expect(run(['analytics', 'history'])[0]).toMatchObject({
      missingAttempts: [1], latest: { strategy: 'adaptive-coverage', model: 'jev-test', inputTokens: 9106 },
    });

    const database = join(data, 'analytics.sqlite');
    const canTestModes = !!process.getuid && process.getuid() !== 0;
    if (canTestModes) chmodSync(database, 0o400);
    else {
      renameSync(database, database + '.saved');
      mkdirSync(database);
    }
    const hit = run(['--metrics'], input);
    expect(hit).toMatchObject({
      status: 'advisory', cache: 'hit', callsAvoided: 1, metrics: { calls: 0, inputTokens: 0, outputTokens: 0 },
      analytics: { status: 'failed', diagnostic: { code: canTestModes ? 'write-denied' : 'unsafe-storage' } },
    });
    if (canTestModes) {
      expect(hit.analytics.nextAction).toBe('request-analytics-write-approval-once');
      expect(run(['analytics', 'summary'])).toMatchObject({ operations: 1, inputTokens: 9106 });
      chmodSync(database, 0o600);
    } else {
      rmSync(database, { recursive: true });
      renameSync(database + '.saved', database);
    }
    const recovery = hit.analytics.recovery;
    expect(JSON.stringify(recovery)).not.toContain(task);
    expect(JSON.stringify(recovery)).not.toContain(project);
    expect(JSON.stringify(recovery)).not.toContain('fake-test-secret');
    expect(run(['analytics', 'recover'], recovery)).toMatchObject({ status: 'recorded', operationId: hit.operationId });
    expect(run(['analytics', 'recover'], recovery)).toMatchObject({ status: 'already-recorded', operationId: hit.operationId });
    expect(run(['analytics', 'summary'])).toMatchObject({
      operations: 2, attempts: 2, apiCalls: 1, inputTokens: 9106, outputTokens: 2064,
      cacheHits: 1, cacheMisses: 1, callsAvoided: 1, estimatedCostUsd: 0.000382452,
    });

    expect(run([], { ...input, task: 'Calcule 2 + 2.', needs: undefined })).toMatchObject({
      status: 'advisory', outcome: 'local-no-judgment', analytics: { status: 'recorded' },
    });
    expect(run(['--no-cache'], input, 'offline')).toMatchObject({
      status: 'native-fallback', analytics: { status: 'recorded' },
    });
    const history = run(['analytics', 'history']);
    expect(history).toHaveLength(4);
    expect(history).toEqual(expect.arrayContaining([
      expect.objectContaining({ latest: expect.objectContaining({ strategy: 'mechanical-task', apiCalls: 0, inputTokens: 0 }) }),
      expect.objectContaining({ latest: expect.objectContaining({
        fallback: 'judgment-failed', inputTokens: null, diagnostic: { code: 'network-unavailable', httpStatus: null },
      }) }),
    ]));
    expect(run(['analytics', 'summary'])).toMatchObject({
      inputTokens: null, knownTotals: { inputTokens: 9106, outputTokens: 2064 },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
