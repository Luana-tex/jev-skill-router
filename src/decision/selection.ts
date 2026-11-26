import { z } from 'zod';
import type { Skill } from '../discovery.js';
import { redundancyCriteria, relevanceCriteria } from './judgment.js';
import type { JudgmentBatch, JudgmentCriteria, JudgmentProvider } from './judgment.js';

export const selectionLimits = z.object({
  minRelevance: z.number().min(0).max(1).default(0.7),
  minRedundancy: z.number().min(0).max(1).default(0.8),
  maxSkills: z.number().int().nonnegative().default(5),
});

interface SelectionOptions extends z.input<typeof selectionLimits> {
  relevanceCriteria?: JudgmentCriteria;
  redundancyCriteria?: JudgmentCriteria;
}

function toJudgmentText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '[código omitido]')
    .replace(/`[^`\r\n]+`/g, '[trecho omitido]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL omitida]')
    .replace(/(?:file:\/\/|[a-z]:[\\/]|\\\\|~\/|\.\.?\/|(?<![\w:/])\/(?!\/))[^\s<>"'`]+/gi, '[caminho omitido]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[e-mail omitido]');
}

export async function selectSkills(
  skills: readonly Skill[],
  task: string,
  provider: JudgmentProvider,
  options: SelectionOptions = {},
) {
  const limits = selectionLimits.parse(options);
  const cleanTask = toJudgmentText(task.trim());
  if (!cleanTask) throw new Error('Informe uma solicitação para avaliar.');

  const selected: Array<Skill & { relevance: number }> = [];
  if (skills.length === 0 || limits.maxSkills === 0) return selected;

  const candidates = skills.map((skill) => ({
    skill,
    data: { name: skill.name, description: toJudgmentText(skill.description) },
  }));
  const batchSize = 16;
  async function judge(batch: Omit<JudgmentBatch, 'task'>) {
    const probabilities = new Map<string, number>();
    const criteria = { true: toJudgmentText(batch.criteria.true), false: toJudgmentText(batch.criteria.false) };
    for (let start = 0; start < batch.candidates.length; start += batchSize) {
      const group = batch.candidates.slice(start, start + batchSize);
      const result = await provider.judge({ ...batch, task: cleanTask, candidates: group, criteria });
      if (result.size !== group.length) throw new Error('Quantidade inválida de julgamentos.');
      for (const { name } of group) {
        const probability = result.get(name);
        if (probability === undefined || !Number.isFinite(probability) || probability < 0 || probability > 1) {
          throw new Error('Probabilidade de julgamento ausente ou inválida.');
        }
        probabilities.set(name, probability);
      }
    }
    return probabilities;
  }

  const relevance = await judge({
    candidates: candidates.map(({ data }) => data),
    criteria: options.relevanceCriteria ?? relevanceCriteria,
  });
  let remaining = candidates
    .map((candidate) => ({ ...candidate, relevance: relevance.get(candidate.data.name)! }))
    .filter((candidate) => candidate.relevance >= limits.minRelevance)
    .sort((a, b) => b.relevance - a.relevance || a.data.name.localeCompare(b.data.name, 'en'));

  while (remaining.length > 0) {
    const [best, ...others] = remaining;
    if (!best) break;
    selected.push({ ...best.skill, relevance: best.relevance });
    if (selected.length === limits.maxSkills || others.length === 0) break;

    const redundancy = await judge({
      candidates: others.map(({ data }) => data),
      against: best.data,
      criteria: options.redundancyCriteria ?? redundancyCriteria,
    });
    remaining = others.filter(({ data }) => redundancy.get(data.name)! < limits.minRedundancy);
  }
  return selected;
}
