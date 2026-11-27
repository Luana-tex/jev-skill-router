#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { z } from 'zod';
import { readJsonInput } from './json-input.js';
import { registerAnalyticsCommands } from './analytics/cli.js';
import { operationRecorder } from './analytics/record.js';
import { codexEarlyFallback, codexNetworkAction, nativeFallback, recommendForCodex } from './codex.js';
import { resolveCodexCredentials } from './codex-config.js';
import { codexDoctor } from './doctor.js';
import { createSelectionCache } from './decision/cache.js';
import { routingMetrics } from './decision/metrics.js';
import { routeSkills } from './decision/routing.js';
import { projectTechnologies } from './decision/technologies.js';
import { createJevProvider } from './decision/jev.js';
import { selectionLimits } from './decision/selection.js';
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

const defaultCacheDirectory = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
const settings = selectionLimits.extend({
  cacheTtlSeconds: z.number().int().min(1).max(Math.floor(Number.MAX_SAFE_INTEGER / 1000)).default(86_400),
  inputUsdPerMillion: z.number().nonnegative().default(0.042),
  outputUsdPerMillion: z.number().nonnegative().default(0),
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
  .option('--baseline', 'Usa o motor da Etapa 2 sem cache ou otimizações.')
  .option('--no-prefilter', 'Encaminha tarefas mecânicas ao motor de julgamento.')
  .option('--no-analytics', 'Desativa o registro de analytics nesta operação.')
  .option('--no-cache', 'Desativa a leitura e gravação do cache.')
  .option('--cache-dir <path>', 'Diretório base do cache.')
  .option('--cache-ttl-seconds <number>', 'Validade do cache em segundos.')
  .option('--input-usd-per-million <number>', 'Tarifa em USD por milhão de tokens de entrada.')
  .option('--output-usd-per-million <number>', 'Tarifa em USD por milhão de tokens de saída.')
  .option('--technology <name...>', 'Tecnologias adicionais do projeto.')
  .option('--exclude-skill <name...>', 'Exclui skills pelo nome exato.')
  .option('--only-skill <name...>', 'Limita as candidatas aos nomes indicados.')
  .action(async (task: string, options: DiscoveryOptions & {
    minRelevance?: string;
    minRedundancy?: string;
    maxSkills?: string;
    criteria?: string;
    timeoutMs?: string;
    model?: string;
    baseline?: boolean;
    analytics?: boolean;
    prefilter?: boolean;
    cache?: boolean;
    cacheDir?: string;
    cacheTtlSeconds?: string;
    inputUsdPerMillion?: string;
    outputUsdPerMillion?: string;
    technology?: string[];
    excludeSkill?: string[];
    onlySkill?: string[];
  }) => {
    const config = settings.safeParse({
      minRelevance: optionNumber(options.minRelevance),
      minRedundancy: optionNumber(options.minRedundancy),
      maxSkills: optionNumber(options.maxSkills),
      timeoutMs: optionNumber(options.timeoutMs),
      model: options.model,
      cacheTtlSeconds: optionNumber(options.cacheTtlSeconds),
      inputUsdPerMillion: optionNumber(options.inputUsdPerMillion),
      outputUsdPerMillion: optionNumber(options.outputUsdPerMillion),
    });
    if (!config.success) {
      throw new Error(`Opções de seleção inválidas (${config.error.issues.map(({ path }) => path[0]).join(', ')}).`);
    }

    const analytics = operationRecorder('cli', { disabled: options.analytics === false });
    const meter = routingMetrics(config.data.inputUsdPerMillion, config.data.outputUsdPerMillion);
    const criteria = await readCriteria(options.criteria);
    const technologies = await projectTechnologies(process.cwd(), options.technology);
    const provider = createJevProvider({
      apiKey: process.env.TYPESAFE_API_KEY,
      model: config.data.model,
      timeoutMs: config.data.timeoutMs,
      onMetrics: (metrics) => {
        meter.record(metrics);
        analytics.recordBatch(metrics);
        console.error(JSON.stringify(metrics));
      },
    });
    const cache = options.cache === false ? undefined : createSelectionCache(
      options.cacheDir ?? defaultCacheDirectory, config.data.cacheTtlSeconds * 1000,
    );
    let result: Awaited<ReturnType<typeof routeSkills>>;
    try {
      result = await routeSkills(await catalog(options), task, provider, {
        ...config.data,
        onEvaluated: analytics.onEvaluated,
        onDecision: analytics.onDecision,
        baseline: options.baseline,
        prefilter: options.prefilter,
        cache,
        technologies,
        excludeSkills: options.excludeSkill,
        onlySkills: options.onlySkill,
        relevanceCriteria: criteria.relevance,
        redundancyCriteria: criteria.redundancy,
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'routing-summary', reason: 'failed', ...meter.summary() }));
      const persistence = await analytics.fail(error, config.data);
      if (persistence.status === 'failed') console.error(JSON.stringify({ event: 'analytics-persistence', ...persistence }));
      throw error;
    }
    const summary = meter.summary();
    const persistence = await analytics.finish(result, config.data);
    if (persistence.status === 'failed') console.error(JSON.stringify({ event: 'analytics-persistence', ...persistence }));
    const { selected, reason, outcome, cache: cacheStatus, callsAvoided } = result;
    console.error(JSON.stringify({
      event: 'routing-summary', reason, outcome, cache: cacheStatus,
      cacheHits: Number(cacheStatus === 'hit'), cacheMisses: Number(cacheStatus === 'miss'),
      callsAvoided, ...summary,
    }));

    if (options.json) {
      console.log(JSON.stringify(selected, null, 2));
      return;
    }
    if (outcome === 'local-no-judgment') console.log('Tarefa encaminhada localmente, sem julgamento de skills.');
    if (outcome === 'no-relevant-skills') console.log('Nenhuma skill relevante encontrada.');
    if (outcome === 'selection-skipped') console.log('Seleção dispensada por catálogo vazio ou limite zero.');
    for (const skill of selected) {
      console.log(`${skill.name} [${skill.scope}] ${(skill.relevance * 100).toFixed(1)}% ${JSON.stringify(skill.path)}`);
    }
  });

program.command('codex-recommend')
  .description('Emite recomendações para a sessão do Codex a partir de JSON em stdin.')
  .option('--no-analytics', 'Desativa o registro de analytics nesta operação.')
  .option('--operation-id <uuid>', 'Correlaciona a operação com a tentativa anterior.')
  .option('--no-cache', 'Desativa a leitura e gravação do cache.')
  .option('--cache-dir <path>', 'Diretório base do cache.')
  .option('--cache-ttl-seconds <number>', 'Validade do cache em segundos.')
  .option('--baseline', 'Executa o motor legado sem cache ou seleção adaptativa.')
  .option('--max-skills <number>', 'Quantidade máxima de recomendações.')
  .option('--min-relevance <number>', 'Probabilidade mínima para considerar uma necessidade coberta.')
  .option('--min-redundancy <number>', 'Probabilidade mínima de redundância no motor legado.')
  .option('--max-context-tokens <number>', 'Orçamento estimado de contexto para a seleção adaptativa.')
  .option('--metrics', 'Inclui métricas agregadas no JSON local.')
  .option('--explain', 'Inclui decisões locais sobre as candidatas.')
  .option('--input-usd-per-million <number>', 'Tarifa em USD por milhão de tokens de entrada.')
  .option('--output-usd-per-million <number>', 'Tarifa em USD por milhão de tokens de saída.')
  .option('--after-network-approval', 'Identifica a única nova tentativa autorizada.')
  .option('--network-approval-denied', 'Emite fallback sem tentar rede após recusa de autorização.')
  .action(async (options: {
    cache?: boolean;
    analytics?: boolean;
    operationId?: string;
    cacheDir?: string;
    cacheTtlSeconds?: string;
    metrics?: boolean;
    baseline?: boolean;
    maxSkills?: string;
    minRelevance?: string;
    minRedundancy?: string;
    maxContextTokens?: string;
    explain?: boolean;
    inputUsdPerMillion?: string;
    outputUsdPerMillion?: string;
    afterNetworkApproval?: boolean;
    networkApprovalDenied?: boolean;
  }) => {
    const analytics = operationRecorder('codex', {
      disabled: options.analytics === false,
      operationId: options.afterNetworkApproval || options.networkApprovalDenied ? options.operationId : undefined,
      secondAttempt: options.afterNetworkApproval || options.networkApprovalDenied,
    });
    let meter: ReturnType<typeof routingMetrics> | undefined;
    let summary: ReturnType<ReturnType<typeof routingMetrics>['summary']> | undefined;
    const publish = (report: object) => console.log(JSON.stringify({
      ...report, operationId: analytics.id, usageTracking: 'not-observed',
      ...(options.metrics ? { metrics: (summary ?? (meter ?? routingMetrics(0, 0)).summary()) } : {}),
    }));
    const earlyFallback = codexEarlyFallback(process.env.JEV_SKILL_ROUTER_DISABLED === '1', !!options.networkApprovalDenied);
    if (earlyFallback) {
      publish({ ...earlyFallback, analytics: await analytics.finish(earlyFallback) });
      return;
    }
    const config = settings.extend({
      maxContextTokens: z.number().int().nonnegative().optional(),
    }).safeParse({
      maxSkills: optionNumber(options.maxSkills),
      minRelevance: optionNumber(options.minRelevance),
      minRedundancy: optionNumber(options.minRedundancy),
      maxContextTokens: optionNumber(options.maxContextTokens),
      cacheTtlSeconds: optionNumber(options.cacheTtlSeconds),
      inputUsdPerMillion: optionNumber(options.inputUsdPerMillion),
      outputUsdPerMillion: optionNumber(options.outputUsdPerMillion),
    });
    if (!config.success) {
      const fallback = nativeFallback('invalid-input');
      publish({ ...fallback, analytics: await analytics.finish(fallback) });
      return;
    }
    const input = await readJsonInput().catch(() => undefined);
    const runMeter = meter = routingMetrics(config.data.inputUsdPerMillion, config.data.outputUsdPerMillion);
    let receivedHttpResponse = false;
    let credentials: ReturnType<typeof resolveCodexCredentials> | undefined;
    const provider = createJevProvider({
      apiKey: async () => (await (credentials ??= resolveCodexCredentials())).key,
      model: config.data.model,
      timeoutMs: config.data.timeoutMs,
      onMetrics: (batch) => {
        receivedHttpResponse ||= batch.status !== undefined;
        runMeter.record(batch);
        analytics.recordBatch(batch);
      },
    });
    const result = await recommendForCodex(input, provider, {
      model: config.data.model,
      cache: options.cache === false ? undefined : createSelectionCache(
        options.cacheDir ?? defaultCacheDirectory, config.data.cacheTtlSeconds * 1000,
      ),
      explain: options.explain,
      onEvaluated: analytics.onEvaluated,
      onDecision: analytics.onDecision,
      baseline: options.baseline,
      maxSkills: config.data.maxSkills,
      minRelevance: config.data.minRelevance,
      minRedundancy: config.data.minRedundancy,
      maxContextTokens: config.data.maxContextTokens,
    });
    summary = runMeter.summary();
    const persistence = await analytics.finish(result, config.data);
    const code = 'diagnostic' in result ? result.diagnostic?.code : undefined;
    const nextAction = codexNetworkAction(code, !!options.afterNetworkApproval, receivedHttpResponse);
    publish({
      ...result, analytics: persistence,
      ...(nextAction ? { nextAction } : {}),
    });
  });

program.command('doctor')
  .description('Verifica a instalação e as credenciais locais, sem consultar a API.')
  .action(async () => {
    console.log(JSON.stringify(await codexDoctor(), null, 2));
  });

program.command('cache-clear')
  .description('Remove as seleções armazenadas no cache local.')
  .option('--cache-dir <path>', 'Diretório base do cache.')
  .action(async (options: { cacheDir?: string }) => {
    const removed = await createSelectionCache(options.cacheDir ?? defaultCacheDirectory, 0).clear();
    console.log(`Entradas de cache removidas: ${removed}.`);
  });

registerAnalyticsCommands(program);

try {
  await program.parseAsync();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha ao executar o comando.');
  process.exitCode = 1;
}
