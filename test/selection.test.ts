import { describe, expect, it, vi } from 'vitest';
import { selectSkills } from '../src/decision/selection.js';
import type { JudgmentBatch } from '../src/decision/judgment.js';
import type { Skill } from '../src/discovery.js';

const skills: Skill[] = ['frontend', 'frontend-copy', 'accessibility', 'unrelated'].map((name) => ({
  name, description: `Help with ${name} at /private/details.ts`, path: `/private/${name}/SKILL.md`, scope: 'local',
}));

function mockProvider(relevance: Record<string, number> = {}) {
  const judge = vi.fn(async ({ against, candidates }: JudgmentBatch) => new Map(candidates.map(({ name }) => [
    name,
    against ? Number(against.name === 'frontend' && name === 'frontend-copy') : relevance[name] ?? 0,
  ])));
  return { judge };
}

describe('selectSkills', () => {
  it('ordena por relevância, remove redundância e preserva contribuições distintas', async () => {
    const provider = mockProvider({ frontend: 0.98, 'frontend-copy': 0.9, accessibility: 0.85 });
    const criteria = { true: 'Relevant', false: 'Unrelated' };
    const result = await selectSkills(skills, 'Revisar tela em /Users/person/app.ts\n```js\nsecret()\n```', provider, {
      relevanceCriteria: criteria,
    });
    expect(result.map(({ name, relevance }) => [name, relevance])).toEqual([['frontend', 0.98], ['accessibility', 0.85]]);
    expect(provider.judge).toHaveBeenCalledTimes(2);
    expect(provider.judge.mock.calls[0]?.[0]).toEqual({
      task: 'Revisar tela em [caminho omitido]\n[código omitido]',
      criteria,
      candidates: skills.map(({ name }) => ({ name, description: `Help with ${name} at [caminho omitido]` })),
    });
    expect(provider.judge.mock.calls[1]?.[0].against?.name).toBe('frontend');
  });

  it('retorna uma lista vazia para probabilidades abaixo do limite', async () => {
    const provider = mockProvider({ frontend: 0.69 });
    expect(await selectSkills(skills, 'Tarefa', provider)).toEqual([]);
    expect(provider.judge).toHaveBeenCalledTimes(1);
  });

  it('respeita limiar inclusivo, limite de quantidade e empate por nome', async () => {
    const provider = mockProvider({ frontend: 0.85, accessibility: 0.85 });
    const result = await selectSkills(skills, 'Tarefa', provider, { maxSkills: 1, minRelevance: 0.85 });
    expect(result.map(({ name }) => name)).toEqual(['accessibility']);
    expect(provider.judge).toHaveBeenCalledTimes(1);
  });

  it('aceita limite de redundância configurado e não consulta um catálogo vazio ou limite zero', async () => {
    const judge = vi.fn(async ({ candidates, against }: JudgmentBatch) =>
      new Map(candidates.map(({ name }) => [name, against ? 0.75 : 0.9])));
    expect(await selectSkills(skills.slice(0, 2), 'Tarefa', { judge }, { minRedundancy: 0.75 })).toHaveLength(1);
    judge.mockClear();
    expect(await selectSkills(skills, 'Tarefa', { judge }, { maxSkills: 0 })).toEqual([]);
    expect(await selectSkills([], 'Tarefa', { judge })).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });

  it('divide catálogos grandes em lotes', async () => {
    const provider = mockProvider();
    const many = Array.from({ length: 33 }, (_, index): Skill => ({
      name: `skill-${index}`, description: 'Uma skill', path: '/dev/null', scope: 'local',
    }));
    expect(await selectSkills(many, 'Tarefa', provider)).toEqual([]);
    expect(provider.judge.mock.calls.map(([batch]) => batch.candidates.length)).toEqual([16, 16, 1]);
  });

  it.each([NaN, Infinity, -1, 1.1, undefined])('rejeita probabilidade inválida (%s)', async (value) => {
    const judge = async () => new Map([['frontend', value as number]]);
    await expect(selectSkills(skills.slice(0, 1), 'Tarefa', { judge })).rejects.toThrow(/ausente ou inválida/);
  });

  it('propaga indisponibilidade sem retornar seleção parcial', async () => {
    const provider = mockProvider({ frontend: 0.98, accessibility: 0.9 });
    provider.judge.mockRejectedValueOnce(new Error('API indisponível'));
    await expect(selectSkills(skills, 'Tarefa', provider)).rejects.toThrow('API indisponível');
  });
});
