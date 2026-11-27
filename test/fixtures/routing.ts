const related = ['frontend', 'accessibility', 'testing', 'typescript', 'frontend-copy'];

export const scenarios = [
  {
    name: 'múltiplas skills complementares',
    task: 'Revise componentes TypeScript, acessibilidade e cobertura de testes no frontend.',
    candidates: related.slice(0, 4),
    scores: [0.99, 0.94, 0.89, 0.88],
    expected: related.slice(0, 4),
  },
  {
    name: 'nenhuma skill relevante',
    task: 'Calcule 2 + 2.',
    candidates: related,
    scores: [0.04, 0.03, 0.06, 0.02, 0.04],
    expected: [],
  },
  {
    name: 'limite e limiar de seleção',
    task: 'Revise a acessibilidade da interface.',
    candidates: related,
    scores: [0.85, 0.85, 0.3, 0.28, 0.22],
    options: { minRelevance: 0.85, maxSkills: 1 },
    expected: ['accessibility'],
  },
  {
    name: 'redundância com contribuições distintas',
    task: 'Audite interface, acessibilidade, regressões e tipos estáticos.',
    candidates: related,
    scores: [0.99, 0.95, 0.92, 0.89, 0.97],
    redundancy: [['frontend', 'frontend-copy']],
    expected: related.slice(0, 4),
  },
  {
    name: 'catálogo em vários lotes',
    task: 'Como devo abordar este projeto?',
    candidates: Array.from({ length: 33 }, (_, index) => `skill-${index}`),
    scores: Array<number>(33).fill(0.55),
    expected: [],
  },
];

export function skill(name: string) {
  return { name, description: `Capacidade de ${name}.`, path: `/local/${name}/SKILL.md`, scope: 'local' as const };
}
