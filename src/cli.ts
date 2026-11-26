#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { discoverSkills } from './discovery.js';

const program = new Command()
  .name('jev-skill-router')
  .description('Descobre Agent Skills disponíveis para roteamento.');

program.command('list')
  .description('Lista as skills locais e globais encontradas.')
  .option('--local-dir <path>', 'Substitui a raiz local de skills.')
  .option('--global-dir <path>', 'Substitui a raiz global de skills.')
  .option('--json', 'Emite a lista em JSON.')
  .action(async (options: { localDir?: string; globalDir?: string; json?: boolean }) => {
    const { skills, issues } = await discoverSkills([
      { scope: 'local', path: options.localDir ?? join(process.cwd(), '.agents', 'skills') },
      { scope: 'global', path: options.globalDir ?? join(homedir(), '.agents', 'skills') },
    ]);

    for (const issue of issues) console.error(`${JSON.stringify(issue.path)} — ${issue.message}`);

    if (options.json) {
      console.log(JSON.stringify(skills, null, 2));
      return;
    }
    if (skills.length === 0) console.log('Nenhuma skill encontrada.');
    for (const skill of skills) {
      console.log(`${skill.name} [${skill.scope}] ${JSON.stringify(skill.path)}\n  ${JSON.stringify(skill.description)}`);
    }
  });

await program.parseAsync();
