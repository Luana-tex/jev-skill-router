import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { recommendForCodex } from '../src/codex.js';
import { createSelectionCache } from '../src/decision/cache.js';
import { createJevProvider } from '../src/decision/jev.js';
import { routingMetrics } from '../src/decision/metrics.js';
import type { CoverageBatch } from '../src/decision/judgment.js';

const model = 'jev-latest';
const task = 'Review a landing page with keyboard accessibility and interaction tests.';
const needs = ['Visual layout', 'Keyboard accessibility', 'Interaction tests'];
const candidate = (name: string, contextTokens?: number) => ({
  name, contextTokens, path: `/local/private/${name.replace(':', '/')}/SKILL.md`, description: `Capability ${name}`,
});

describe('inventário Codex', () => {
  it('aceita nomes qualificados e relata erros de caminho e nome separadamente', async () => {
    const fixture = candidate('sites:sites');
    const judge = vi.fn(async () => new Map([[fixture.name, 0.97]]));
    const result = await recommendForCodex({
      task, availableSkills: [
        fixture,
        { ...candidate('other'), path: '../outside/SKILL.md' },
        { ...candidate('other'), name: 'other:../../evil' },
        { ...candidate('other'), path: '/local/work/../elsewhere/SKILL.md' },
        { ...candidate('other'), path: '/local/work/SKILL.md\n' },
      ],
    }, { judge }, { model });
    expect(result).toMatchObject({
      recommendations: [{ name: 'sites:sites', path: fixture.path, relevance: 0.97 }],
      rejectedCandidates: [
        { index: 1, fields: ['path'] },
        { index: 2, fields: ['name'] },
        { index: 3, fields: ['path'] },
        { index: 4, fields: ['path'] },
      ],
    });
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [{ name: fixture.name, description: fixture.description }],
    }));
  });

  it('preserva seleção explícita qualificada sem contatar a API', async () => {
    const judge = vi.fn();
    expect(await recommendForCodex({ task, needs, availableSkills: [], explicitlySelected: ['sites:sites'] }, { judge }, { model }))
      .toMatchObject({ reason: 'explicit-selection', explicitlySelected: ['sites:sites'] });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe('seleção adaptativa', () => {
  const inventory = [candidate('visual', 500), candidate('layout-plus-a11y', 700),
    candidate('tests', 400), candidate('keyboard', 500), candidate('other', 50)];
  const scores = [
    [0.99, 0.1, 0.1], [0.85, 0.86, 0.2], [0.1, 0.1, 0.91], [0.1, 0.99, 0.1], [0.1, 0.1, 0.1],
  ];
  function fixtureProvider() {
    return {
      judge: vi.fn(),
      judgeCoverage: vi.fn(async ({ candidates }: CoverageBatch) =>
        candidates.map(({ name }) => scores[inventory.findIndex((entry) => entry.name === name)]!)),
    };
  }

  it('escolhe o menor conjunto suficiente acima do limiar, sem rodadas de redundância', async () => {
    const provider = fixtureProvider();
    const result = await recommendForCodex({ task, needs, availableSkills: inventory }, provider, {
      model, maxContextTokens: 1200, explain: true,
    });
    expect(result).toMatchObject({
      reason: 'adaptive-coverage',
      coverage: { covered: [0, 1, 2], uncovered: [], estimatedContextTokens: 1100 },
      recommendations: [{ name: 'layout-plus-a11y' }, { name: 'tests' }],
      explanation: { decisions: expect.arrayContaining([{ name: 'visual', relevance: 0.99, decision: 'covered-by-set' }]) },
    });
    expect(provider.judgeCoverage).toHaveBeenCalledTimes(1);
    expect(provider.judge).not.toHaveBeenCalled();
  });

  it('maximiza cobertura parcial sob orçamento e limite, sem declarar necessidades cobertas indevidamente', async () => {
    const provider = fixtureProvider();
    expect(await recommendForCodex({ task, needs, availableSkills: inventory }, provider, {
      model, maxContextTokens: 800, maxSkills: 1,
    })).toMatchObject({
      coverage: { covered: [0, 1], uncovered: [2], estimatedContextTokens: 700 },
      recommendations: [{ name: 'layout-plus-a11y' }],
    });
  });

  it('mantém o baseline legado disponível mesmo quando há necessidades declaradas', async () => {
    const provider = fixtureProvider();
    provider.judge.mockImplementation(async ({ candidates }) =>
      new Map(candidates.map(({ name }: { name: string }) => [name, 0.95])));
    expect(await recommendForCodex({ task, needs, availableSkills: inventory }, provider, {
      model, baseline: true, maxSkills: 1,
    })).toMatchObject({ reason: 'baseline', recommendations: [{ name: 'keyboard' }] });
    expect(provider.judgeCoverage).not.toHaveBeenCalled();
  });

  it('separa o cache adaptativo por orçamento, custos e necessidades', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jev-adaptive-test-'));
    try {
      const provider = fixtureProvider();
      const cache = createSelectionCache(directory, 60_000);
      const input = { task, needs, availableSkills: inventory };
      const options = { model, cache, maxContextTokens: 1200 };
      const first = await recommendForCodex(input, provider, options);
      expect(first).toMatchObject({ cache: 'miss', coverage: { uncovered: [] } });
      expect(await recommendForCodex(input, provider, options)).toMatchObject({ cache: 'hit', coverage: { uncovered: [] } });
      expect(await recommendForCodex(input, provider, { ...options, maxContextTokens: 800 })).toMatchObject({ cache: 'miss' });
      expect(await recommendForCodex({ ...input, needs: needs.slice(0, 2) }, {
        ...provider, judgeCoverage: async ({ candidates }) => candidates.map(() => [0.95, 0.95]),
      }, options)).toMatchObject({ cache: 'miss' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('compara 28 candidatas por HTTP simulado, sem transportar caminhos ou estimativas locais', async () => {
  const inventory = Array.from({ length: 28 }, (_, index) => candidate(`skill-${String(index).padStart(2, '0')}`, 100));
  const requirements = [...needs, 'Responsive rendering'];
  async function run(adaptive: boolean) {
    const meter = routingMetrics(0.042, 0);
    const provider = createJevProvider({ model, apiKey: 'fake-key', timeoutMs: 1000, onMetrics: meter.record },
      async (_url, init) => {
        const raw = String(init?.body);
        const body = JSON.parse(raw);
        expect(raw).not.toMatch(/local\/private|contextTokens|fake-key/);
        const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
          const { instructions } = question as { instructions: string };
          const candidateIndex = Number(/state\.candidates\[(\d+)\]/.exec(instructions)?.[1]);
          const nameIndex = Number(body.state.candidates[candidateIndex].name.slice(-2));
          const need = Number(/state\.needs\[(\d+)\]/.exec(instructions)?.[1]);
          const probability = body.state.needs ? Number(nameIndex % requirements.length === need) * 0.9
            : body.state.reference ? 0.1 : 0.9;
          return [id, { type: 'noul', noul: probability }];
        }));
        return Response.json({
          model, answers, usage: { input_tokens: Math.ceil(Buffer.byteLength(raw) / 4), output_tokens: Object.keys(answers).length * 2 },
        });
      });
    const result = await recommendForCodex({
      task, availableSkills: inventory, ...(adaptive ? { needs: requirements } : {}),
    }, provider, { model });
    return { result, ...meter.summary() };
  }

  const previous = await run(false);
  const adaptive = await run(true);
  expect(previous.result.recommendations).toHaveLength(5);
  expect(previous.calls).toBe(10);
  expect(adaptive.result).toMatchObject({ coverage: { covered: [0, 1, 2, 3], uncovered: [] } });
  expect(adaptive.result.recommendations).toHaveLength(4);
  expect(adaptive.calls).toBe(4);
  expect(adaptive.outputTokens).toBeLessThan(previous.outputTokens);
  console.log(JSON.stringify({
    legacy: { calls: previous.calls, input: previous.inputTokens, output: previous.outputTokens },
    adaptive: { calls: adaptive.calls, input: adaptive.inputTokens, output: adaptive.outputTokens },
  }));
});
