import { describe, expect, it, vi } from 'vitest';
import { codexEarlyFallback, codexNetworkAction, recommendForCodex } from '../src/codex.js';
import { createJevProvider } from '../src/decision/jev.js';

const model = 'jev-latest';
const candidate = {
  name: 'layout-review', description: 'Review screen layout.',
  path: '/project/.agents/skills/layout-review/SKILL.md',
};
const router = {
  name: 'jev-skill-router', description: 'Recommend candidates.',
  path: '/global/jev-skill-router/SKILL.md',
};
const input = { task: 'Review the mobile layout.', availableSkills: [candidate, router] };
const response = {
  model, usage: { input_tokens: 40, output_tokens: 2 }, answers: { q0: { type: 'noul', noul: 0.95 } },
};

describe('recommendForCodex', () => {
  it('returns an advisory result only for visible and unambiguous candidates', async () => {
    const duplicate = { name: 'duplicate', description: 'Ambiguous.', path: '/private/duplicate/SKILL.md' };
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(response));
    const provider = createJevProvider({ apiKey: 'test-key', timeoutMs: 1000, model }, transport);
    const result = await recommendForCodex({
      task: 'Review the mobile layout. /private/project/file.ts test-key',
      availableSkills: [...input.availableSkills, duplicate, { ...duplicate, path: '/other/SKILL.md' }],
    }, provider, { model });

    expect(result).toMatchObject({
      status: 'advisory', recommendations: [{ name: candidate.name, path: candidate.path, relevance: 0.95 }],
    });
    const body = String(transport.mock.calls[0]?.[1]?.body);
    const { state } = JSON.parse(body);
    expect(state.candidates).toEqual([{ name: candidate.name, description: candidate.description }]);
    for (const value of ['/private/', 'test-key', 'SKILL.md', 'jev-skill-router', 'duplicate']) expect(body).not.toContain(value);
  });

  it('preserves explicitly requested skills regardless of the recommendation catalog', async () => {
    const judge = vi.fn();
    expect(await recommendForCodex({ ...input, explicitlySelected: [router.name, 'custom-user-choice'] }, { judge }, {
      model,
    })).toEqual({
      status: 'native-fallback', reason: 'explicit-selection', explicitlySelected: ['custom-user-choice'], recommendations: [],
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it('falls back on malformed input, disabled integration and simulated provider failure', async () => {
    const judge = vi.fn().mockRejectedValue(new Error('sensitive failure'));
    expect(await recommendForCodex({ ...input, extra: 'private file body' }, { judge }, { model }))
      .toMatchObject({ status: 'native-fallback', reason: 'invalid-input' });
    expect(await recommendForCodex(input, { judge }, { model, disabled: true }))
      .toMatchObject({ status: 'native-fallback', reason: 'disabled' });
    expect(await recommendForCodex(input, { judge }, { model }))
      .toEqual({ status: 'native-fallback', reason: 'judgment-failed', explicitlySelected: [], recommendations: [] });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('reuses the local prefilter and excludes the router even when it is the only candidate', async () => {
    const judge = vi.fn();
    expect(await recommendForCodex({ ...input, task: 'Calcule 2 + 2.' }, { judge }, { model })).toMatchObject({
      status: 'advisory', outcome: 'local-no-judgment', recommendations: [],
    });
    expect(await recommendForCodex({ ...input, availableSkills: [router] }, { judge }, { model })).toMatchObject({
      status: 'advisory', reason: 'no-candidates', recommendations: [],
    });
    expect(judge).not.toHaveBeenCalled();
  });

  it('discards recognizable credential material before calling the provider', async () => {
    const judge = vi.fn();
    expect(await recommendForCodex({ ...input, task: 'Review the mock UI. Bearer abcdefghijklmnop' }, { judge }, { model }))
      .toMatchObject({ status: 'native-fallback', reason: 'private-input' });
    expect(judge).not.toHaveBeenCalled();
  });
});

describe('diagnósticos do Codex', () => {
  it.each([
    { error: new Error('DNS com dado privado'), code: 'network-unavailable' },
    { error: new Error('fetch failed', { cause: { code: 'EPERM', detail: 'private' } }), code: 'network-blocked' },
    { error: new Error('timed out', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }), code: 'timeout' },
  ])('classifica falha de transporte como $code', async ({ error, code }) => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(error);
    const provider = createJevProvider({ apiKey: 'test-key', timeoutMs: 1000, model }, transport);
    expect(await recommendForCodex(input, provider, { model })).toMatchObject({
      status: 'native-fallback', reason: 'judgment-failed', diagnostic: { code },
    });
  });

  it.each([
    [401, 'authentication-failed'],
    [403, 'access-denied'],
    [429, 'rate-limited'],
    [503, 'http-error'],
    [200, 'invalid-response'],
  ] as const)('classifica resposta HTTP %i sem vazar conteúdo', async (status, code) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('private payload test-key', { status }));
    const provider = createJevProvider({ apiKey: 'test-key', timeoutMs: 1000, model }, transport);
    const result = await recommendForCodex(input, provider, { model });
    expect(result).toMatchObject({ diagnostic: { code, httpStatus: status } });
    expect(JSON.stringify(result)).not.toMatch(/test-key|private payload/);
  });

  it('não tenta rede se a configuração não disponibiliza uma chave', async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = createJevProvider({ timeoutMs: 1000, model }, transport);
    expect(await recommendForCodex(input, provider, { model })).toMatchObject({
      status: 'native-fallback', diagnostic: { code: 'missing-credentials' },
    });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('aprovação de rede', () => {
  it.each(['network-unavailable', 'network-blocked'] as const)('orienta uma autorização para %s', (code) => {
    expect(codexNetworkAction(code, false, false)).toBe('request-network-approval-once');
    expect(codexNetworkAction(code, true, false)).toBeUndefined();
    expect(codexNetworkAction(code, false, true)).toBeUndefined();
  });

  it('mantém fallback nativo quando a autorização é recusada', () => {
    expect(codexEarlyFallback(false, true)).toEqual({
      status: 'native-fallback', reason: 'network-approval-denied', explicitlySelected: [], recommendations: [],
    });
    expect(codexNetworkAction('authentication-failed', false, false)).toBeUndefined();
    expect(codexNetworkAction('timeout', false, false)).toBeUndefined();
  });
});

it('distingue candidatas ausentes, duplicadas, redundantes e fora do limite sem novas chamadas', async () => {
  const names = ['layout', 'broad-design', 'layout-copy', 'typography', 'unrelated', 'motion', 'content', 'color'];
  const scores = new Map([['layout', 0.98], ['broad-design', 0.8], ['layout-copy', 0.90], ['typography', 0.89], ['unrelated', 0.2], ['motion', 0.83], ['content', 0.82], ['color', 0.79]]);
  const skills = names.map((name) => ({ name, description: 'Sample capability', path: `/fixture/${name}/SKILL.md` }));
  const duplicate = { name: 'duplicate', description: 'Sample duplicate', path: '/fixture/duplicate/SKILL.md' };
  const provider = { judge: vi.fn(async (batch: import('../src/decision/judgment.js').JudgmentBatch) =>
    new Map(batch.candidates.map(({ name }) => [name, batch.against ? Number(name === 'layout-copy') : scores.get(name)!]))) };
  const result = await recommendForCodex({
    ...input, availableSkills: [...skills, duplicate, { ...duplicate, path: '/another/duplicate/SKILL.md' }],
  }, provider, { model, explain: true });
  expect(result).toMatchObject({
    explanation: {
      submitted: [...names, 'duplicate'], excludedDuplicates: ['duplicate'],
      decisions: expect.arrayContaining([
        { name: 'layout-copy', decision: 'redundant', relevance: 0.9, coveredBy: 'layout' },
        { name: 'unrelated', decision: 'below-relevance', relevance: 0.2 },
        { name: 'broad-design', decision: 'selected', relevance: 0.8 },
        { name: 'color', decision: 'selection-limit', relevance: 0.79 },
      ]),
    },
  });
  expect(provider.judge).toHaveBeenCalledTimes(5);
});
