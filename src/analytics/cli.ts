import { Command, InvalidArgumentError } from 'commander';
import { readJsonInput } from '../json-input.js';
import { persistenceDiagnostic } from './diagnostic.js';
import { recoverySchema } from './domain.js';
import { analyticsDirectory, analyticsService, exportCsv, groupStatistics, summarize, topSkills } from './service.js';

function limit(value: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new InvalidArgumentError('Informe um inteiro positivo.');
  return number;
}

function timestamp(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || !/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) {
    throw new InvalidArgumentError('Informe uma data ISO ou um horário ISO com fuso.');
  }
  return parsed.toISOString();
}

function project(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new InvalidArgumentError('Informe o identificador anonimizado do projeto.');
  return value;
}

function filters(command: Command) {
  return command
    .option('--since <iso>', 'Início do período, inclusivo.', timestamp)
    .option('--until <iso>', 'Fim do período, exclusivo.', timestamp)
    .option('--project <id>', 'Identificador anonimizado do projeto.', project);
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function service() {
  return analyticsService(analyticsDirectory());
}

export function registerAnalyticsCommands(program: Command) {
  const analytics = program.command('analytics').description('Gerencia o histórico local de roteamento.');
  analytics.command('enable').description('Ativa o registro local de novas operações.').action(() => {
    service().setEnabled(true);
    print({ enabled: true, environmentOverride: process.env.JEV_ANALYTICS === 'off' });
  });
  analytics.command('disable').description('Desativa o registro de novas operações.').action(() => {
    service().setEnabled(false);
    print({ enabled: false });
  });
  analytics.command('status').description('Informa se o registro está ativo.').action(() => {
    print({ enabled: service().enabled() && process.env.JEV_ANALYTICS !== 'off' });
  });
  filters(analytics.command('summary')).description('Resume métricas do histórico.').action(async (options) => {
    print(summarize(await service().history({ ...options, projectId: options.project })));
  });
  filters(analytics.command('history')).description('Lista operações e suas tentativas.')
    .option('--limit <n>', 'Máximo de operações.', limit, 50).action(async (options) => {
      print(await service().history({ ...options, projectId: options.project }));
    });
  filters(analytics.command('period')).description('Agrupa estatísticas por dia UTC.').action(async (options) => {
    print(groupStatistics(await service().history({ ...options, projectId: options.project }), 'period'));
  });
  filters(analytics.command('projects')).description('Agrupa estatísticas por projeto anonimizado.').action(async (options) => {
    print(groupStatistics(await service().history({ ...options, projectId: options.project }), 'project'));
  });
  filters(analytics.command('skills')).description('Lista as skills mais recomendadas.')
    .option('--limit <n>', 'Máximo de skills.', limit, 20).action(async ({ limit: count, ...options }) => {
      print(topSkills(await service().history({ ...options, projectId: options.project }), count));
    });
  filters(analytics.command('export')).description('Exporta o histórico em JSON ou CSV.')
    .option('--format <format>', 'Formato de exportação.', 'json').action(async (options) => {
      if (options.format !== 'json' && options.format !== 'csv') throw new Error('Formato de exportação deve ser json ou csv.');
      const history = await service().history({ ...options, projectId: options.project });
      if (options.format === 'csv') console.log(exportCsv(history));
      else print(history);
    });
  analytics.command('recover').description('Grava um registro recuperado a partir de JSON em stdin, sem rede.')
    .action(async () => {
      if (process.env.JEV_ANALYTICS === 'off') {
        print({ status: 'disabled' });
        return;
      }
      const parsed = recoverySchema.safeParse(await readJsonInput(1024 * 1024).catch(() => undefined));
      if (!parsed.success) {
        print({ status: 'failed', diagnostic: { code: 'invalid-snapshot' } });
        process.exitCode = 1;
        return;
      }
      const { id, attempt, source, data, recordedAt } = parsed.data;
      try {
        const status = await service().record(id, attempt, source, process.cwd(), data, recordedAt);
        print({ status, operationId: id });
      } catch (error) {
        print({ status: 'failed', diagnostic: { code: persistenceDiagnostic(error) } });
        process.exitCode = 1;
      }
    });
  analytics.command('clear').description('Apaga o histórico após confirmação explícita.')
    .option('--yes', 'Confirma a exclusão do histórico.').action(async (options: { yes?: boolean }) => {
      if (!options.yes) throw new Error('Confirme a exclusão com analytics clear --yes.');
      print({ deleted: await service().clear() });
    });
}
