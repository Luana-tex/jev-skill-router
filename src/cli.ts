#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import { createJevProvider } from './decision/jev.js';
import { selectSkills, selectionLimits } from './decision/selection.js';
import { discoverSkills } from './discovery.js';

interface DiscoveryOptions {
  localDir?: string;
  globalDir?: string;
  json?: boolean;
}

const program = new Command()
  .name('jev-skill-router')
  .description('Descobre Agent Skills e avalia sua relevância para uma tarefa.');

function addDiscoveryOptions(command: Command) {
  return command
    .option('--local-dir <path>', 'Substitui a raiz local de skills.')
    .option('--global-dir <path>', 'Substitui a raiz global de skills.')
    .option('--json', 'Emite o resultado em JSON.');
}

async function catalog(options: DiscoveryOptions) {
  const { skills, issues } = await discoverSkills([
    { scope: 'local', path: options.localDir ?? join(process.cwd(), '.agents', 'skills') },
    { scope: 'global', path: options.globalDir ?? join(homedir(), '.agents', 'skills') },
  ]);
  for (const issue of issues) console.error(`${JSON.stringify(issue.path)} — ${issue.message}`);
  return skills;
}

addDiscoveryOptions(program.command('list'))
  .description('Lista as skills locais e globais encontradas.')
  .action(async (options: DiscoveryOptions) => {
    const skills = await catalog(options);

    if (options.json) {
      console.log(JSON.stringify(skills, null, 2));
      return;
    }
    if (skills.length === 0) console.log('Nenhuma skill encontrada.');
    for (const skill of skills) {
      console.log(`${skill.name} [${skill.scope}] ${JSON.stringify(skill.path)}\n  ${JSON.stringify(skill.description)}`);
    }
  });

const settings = selectionLimits.extend({
  model: z.string().trim().min(1).default('jev-latest'),
  timeoutMs: z.number().int().min(1).max(2_147_483_647).default(10_000),
});

const criterion = z.strictObject({ true: z.string().trim().min(1), false: z.string().trim().min(1) });
const criteriaSchema = z.strictObject({
  relevance: criterion.optional(),
  redundancy: criterion.optional(),
});

async function readCriteria(path?: string) {
  if (!path) return {};
  try {
    return criteriaSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new Error('Não foi possível ler um arquivo de critérios válido.');
  }
}

function optionNumber(value?: string) {
  return value === undefined ? undefined : value.trim() ? Number(value) : NaN;
}

addDiscoveryOptions(program.command('select'))
  .description('Seleciona skills relevantes para uma solicitação usando Jev.')
  .argument('<task>', 'Descrição da tarefa, sem dados privados.')
  .option('--min-relevance <number>', 'Probabilidade mínima de relevância (padrão 0.7).')
  .option('--min-redundancy <number>', 'Probabilidade a partir da qual a skill é redundante (padrão 0.8).')
  .option('--max-skills <number>', 'Quantidade máxima de skills (padrão 5).')
  .option('--criteria <path>', 'Arquivo JSON com critérios de relevância e redundância.')
  .option('--timeout-ms <number>', 'Tempo limite por requisição em milissegundos (padrão 10000).')
  .option('--model <name>', 'Modelo Jev (padrão jev-latest).')
  .action(async (task: string, options: DiscoveryOptions & {
    minRelevance?: string;
    minRedundancy?: string;
    maxSkills?: string;
    criteria?: string;
    timeoutMs?: string;
    model?: string;
  }) => {
    const config = settings.safeParse({
      minRelevance: optionNumber(options.minRelevance),
      minRedundancy: optionNumber(options.minRedundancy),
      maxSkills: optionNumber(options.maxSkills),
      timeoutMs: optionNumber(options.timeoutMs),
      model: options.model,
    });
    if (!config.success) {
      throw new Error(`Opções de seleção inválidas (${config.error.issues.map(({ path }) => path[0]).join(', ')}).`);
    }

    const criteria = await readCriteria(options.criteria);
    const provider = createJevProvider({
      apiKey: process.env.TYPESAFE_API_KEY,
      model: config.data.model,
      timeoutMs: config.data.timeoutMs,
      onMetrics: (metrics) => console.error(JSON.stringify(metrics)),
    });
    const selected = await selectSkills(await catalog(options), task, provider, {
      ...config.data,
      relevanceCriteria: criteria.relevance,
      redundancyCriteria: criteria.redundancy,
    });

    if (options.json) {
      console.log(JSON.stringify(selected, null, 2));
      return;
    }
    if (selected.length === 0) console.log('Nenhuma skill relevante encontrada.');
    for (const skill of selected) {
      console.log(`${skill.name} [${skill.scope}] ${(skill.relevance * 100).toFixed(1)}% ${JSON.stringify(skill.path)}`);
    }
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao executar o comando.');
  process.exitCode = 1;
}
