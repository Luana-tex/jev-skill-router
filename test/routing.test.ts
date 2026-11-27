import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSelectionCache } from '../src/decision/cache.js';
import type { JudgmentBatch } from '../src/decision/judgment.js';
import { routeSkills } from '../src/decision/routing.js';
import { projectTechnologies } from '../src/decision/technologies.js';
import { skill } from './fixtures/routing.js';
import { prefilterScenarios } from './fixtures/prefilter.js';

const model = 'jev-latest';
const catalog = [skill('react'), skill('test')];

function fakeProvider() {
  return { judge: vi.fn(async ({ candidates }: JudgmentBatch) => new Map(candidates.map(({ name }) => [name, 0.92]))) };
}

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'jev-cache-test-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('roteamento', () => {
  it('encaminha tarefas ambíguas, especializadas ou com qualificadores', async () => {
    for (const task of ['O que devo fazer?', 'Calcule 2 + 2 usando TensorFlow', 'Responda exatamente com "ok" e rode os testes']) {
      const provider = fakeProvider();
      const result = await routeSkills(catalog, task, provider, { model });
      expect(result.reason).toBe('needs-judgment');
      expect(provider.judge).toHaveBeenCalled();
    }
  });

  it('permite desativar o pré-filtro e aplica restrições antes de consultar o provedor', async () => {
    const provider = fakeProvider();
    const task = 'Responda exatamente com "ok".';
    const local = await routeSkills(catalog, task, provider, { model });
    expect(local).toMatchObject({ reason: 'mechanical-task', selected: [], callsAvoided: 1 });
    expect(provider.judge).not.toHaveBeenCalled();

    const remote = await routeSkills(catalog, task, provider, {
      model, prefilter: false, excludeSkills: ['test'], onlySkills: ['test', 'react'], technologies: ['React'],
    });
    expect(remote.reason).toBe('prefilter-disabled');
    expect(remote.selected.map(({ name }) => name)).toEqual(['react']);
    expect(provider.judge).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [{ name: 'react', description: 'Capacidade de react.' }], technologies: ['React'],
    }));
  });

  it('julga uma tarefa mecânica quando há critérios personalizados', async () => {
    const provider = fakeProvider();
    const result = await routeSkills(catalog, 'Calcule 2 + 2', provider, {
      model, relevanceCriteria: { true: 'Exact calculations', false: 'Anything else' },
    });
    expect(result.reason).toBe('needs-judgment');
  });

  it('apenas infere tecnologias conhecidas e aceita rótulos informados', () => withDirectory(async (directory) => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      dependencies: { react: 'latest', '@company/private-project': 'secret' }, devDependencies: { vitest: '5' },
    }));
    expect(await projectTechnologies(directory, ['Rust', 'React'])).toEqual(['React', 'Rust', 'Vitest']);
  }));
});

describe('cache persistente', () => {
  it('reutiliza resultados e não grava prompts, metadados ou caminhos em texto puro', () => withDirectory(async (directory) => {
    const provider = fakeProvider();
    const task = 'Tarefa privada de revisão confidencial.';
    const cache = createSelectionCache(directory, 60_000);
    const first = await routeSkills(catalog, task, provider, { model, cache });
    expect(first.cache).toBe('miss');
    provider.judge.mockClear();
    const next = await routeSkills(catalog, task, provider, { model, cache: createSelectionCache(directory, 60_000) });
    expect(next).toMatchObject({ selected: first.selected, cache: 'hit', callsAvoided: 2 });
    expect(provider.judge).not.toHaveBeenCalled();

    const dir = join(directory, 'jev-skill-router-cache-v1');
    const entries = (await readdir(dir)).filter((name) => name.endsWith('.json'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[a-f0-9]{64}\.json$/);
    const stored = await readFile(join(dir, entries[0]!), 'utf8');
    for (const privateValue of [task, catalog[0]!.description, catalog[0]!.path, 'react']) {
      expect(stored).not.toContain(privateValue);
    }
  }));

  it('invalida por catálogo, tarefa, modelo, tecnologias e configuração', () => withDirectory(async (directory) => {
    const provider = fakeProvider();
    const options = { model, cache: createSelectionCache(directory, 60_000) };
    const task = 'Revisar aplicação.';
    expect((await routeSkills(catalog, task, provider, options)).cache).toBe('miss');
    for (const changes of [{ model: 'jev-1.14.0' }, { minRelevance: 0.95 }, { technologies: ['React'] },
      { excludeSkills: ['react'] }, { prefilter: false }]) {
      expect((await routeSkills(catalog, task, provider, { ...options, ...changes })).cache).toBe('miss');
    }
    expect((await routeSkills([{ ...catalog[0]!, description: 'alteração' }, catalog[1]!], task, provider, options)).cache).toBe('miss');
    expect((await routeSkills(catalog, 'Outra tarefa', provider, options)).cache).toBe('miss');
  }));

  it('expira, limpa e permite contornar o cache', () => withDirectory(async (directory) => {
    const provider = fakeProvider();
    const task = 'Revisar aplicação.';
    const cache = createSelectionCache(directory, 60_000);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await routeSkills(catalog, task, provider, { model, cache });
      expect((await routeSkills(catalog, task, provider, { model })).cache).toBe('bypassed');
      expect((await routeSkills(catalog, task, provider, { model, cache, baseline: true })).cache).toBe('bypassed');
      clock.mockReturnValue(now + 60_000);
      expect((await routeSkills(catalog, task, provider, { model, cache })).cache).toBe('miss');
      expect(await cache.clear()).toBe(1);
      expect((await routeSkills(catalog, task, provider, { model, cache })).cache).toBe('miss');
    } finally {
      clock.mockRestore();
    }
  }));

  it('não persiste falhas e tolera diretório indisponível', () => withDirectory(async (directory) => {
    const provider = fakeProvider();
    const task = 'Revisar aplicação.';
    const cache = createSelectionCache(directory, 60_000);
    provider.judge.mockRejectedValueOnce(new Error('API indisponível'));
    await expect(routeSkills(catalog, task, provider, { model, cache })).rejects.toThrow('API indisponível');
    expect(await cache.clear()).toBe(0);
    const blocked = join(directory, 'file');
    await writeFile(blocked, 'x');
    const result = await routeSkills(catalog, task, provider, { model, cache: createSelectionCache(blocked, 60_000) });
    expect(result.cache).toBe('unavailable');
    expect(result.selected).toHaveLength(1);
  }));
});

describe('calibração bilíngue', () => {
  it('mede falsos positivos e negativos do pré-filtro nas fixtures', async () => {
    const falsePositives: string[] = [];
    const falseNegatives: string[] = [];
    for (const { task, local } of prefilterScenarios) {
      const provider = { judge: vi.fn(async ({ candidates }: JudgmentBatch) =>
        new Map(candidates.map(({ name }) => [name, 0.1]))) };
      const result = await routeSkills(catalog, task, provider, { model, technologies: ['React'] });
      const skipped = result.outcome === 'local-no-judgment';
      if (skipped && !local) falsePositives.push(task);
      if (!skipped && local) falseNegatives.push(task);
      expect(provider.judge).toHaveBeenCalledTimes(skipped ? 0 : 1);
      expect(result.outcome).toBe(skipped ? 'local-no-judgment' : 'no-relevant-skills');
      if (task.includes('`react`')) {
        expect(provider.judge).toHaveBeenCalledWith(expect.objectContaining({
          task: task.replace('`react`', 'react'),
        }));
      }
    }
    expect(falsePositives).toEqual([]);
    expect(falseNegatives).toEqual([]);
  });

  it('mantém julgamento quando há candidatura explícita, menção a um nome ou baseline', async () => {
    const provider = fakeProvider();
    const task = 'Fix a typo in README.md.';
    expect((await routeSkills(catalog, task, provider, { model, onlySkills: ['react'] })).selected[0]?.name).toBe('react');
    expect((await routeSkills([...catalog, skill('readme')], task, provider, { model })).reason).toBe('needs-judgment');
    expect((await routeSkills(catalog, task, provider, { model, baseline: true })).reason).toBe('baseline');
  });

  it('invalida entradas sem versão de política e preserva a ausência julgada em cache', () => withDirectory(async (directory) => {
    const cache = createSelectionCache(directory, 60_000);
    const entry = vi.spyOn(cache, 'entry');
    const task = 'Fix a typo in app.ts.';
    const provider = { judge: vi.fn(async ({ candidates }: JudgmentBatch) =>
      new Map(candidates.map(({ name }) => [name, 0.1]))) };
    const first = await routeSkills(catalog, task, provider, { model, cache });
    expect(first.outcome).toBe('no-relevant-skills');
    const [key] = entry.mock.calls[0]!;
    expect(Array.isArray(key) && key[0]).toBe('routing-3.1');
    await cache.clear();
    const legacy = await cache.entry((key as unknown[]).slice(1));
    await legacy.write({ baselineCalls: 1, selected: [{ index: 0, relevance: 1 }] });
    expect(await routeSkills(catalog, task, provider, { model, cache })).toMatchObject({
      cache: 'miss', outcome: 'no-relevant-skills', selected: [],
    });
    expect(await routeSkills(catalog, task, provider, { model, cache })).toMatchObject({
      cache: 'hit', outcome: 'no-relevant-skills', selected: [],
    });
    expect(provider.judge).toHaveBeenCalledTimes(2);
  }));
});
