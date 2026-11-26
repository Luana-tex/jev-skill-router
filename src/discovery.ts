import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseSkillMetadata } from './metadata.js';
import type { SkillMetadata } from './metadata.js';

export type SkillScope = 'local' | 'global';
export type Skill = SkillMetadata & { path: string; scope: SkillScope };

export interface SkillRoot {
  path: string;
  scope: SkillScope;
}

interface DiscoveryIssue {
  path: string;
  message: string;
}

const skillFileName = 'SKILL.md';

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

export async function discoverSkills(roots: readonly SkillRoot[]) {
  const skills = new Map<string, Skill>();
  const issues: DiscoveryIssue[] = [];
  const orderedRoots = [
    ...roots.filter(({ scope }) => scope === 'local'),
    ...roots.filter(({ scope }) => scope === 'global'),
  ];
  const seenFiles = new Set<string>();
  const seenDirectories = new Map<SkillScope, Set<string>>();

  for (const root of orderedRoots) {
    const visited = seenDirectories.get(root.scope) ?? new Set<string>();
    seenDirectories.set(root.scope, visited);
    const pending = [{ path: resolve(root.path), isRoot: true }];
    while (pending.length > 0) {
      const entry = pending.pop()!;
      let currentPath = entry.path;
      try {
        const directory = await realpath(entry.path);
        if (visited.has(directory)) continue;
        if (!(await stat(directory)).isDirectory()) {
          if (entry.isRoot) issues.push({ path: currentPath, message: 'A raiz deve ser um diretório.' });
          continue;
        }
        visited.add(directory);

        const entries = await readdir(directory, { withFileTypes: true });
        const manifest = entries.find(({ name }) => name === skillFileName);
        if (!manifest || (!manifest.isFile() && !manifest.isSymbolicLink())) {
          const children = entries
            .filter((child) => child.isDirectory() || child.isSymbolicLink())
            .map((child) => child.name)
            .sort().reverse();
          for (const child of children) {
            pending.push({ path: join(directory, child), isRoot: false });
          }
          continue;
        }

        currentPath = join(directory, skillFileName);
        const file = await realpath(currentPath);
        if (seenFiles.has(file)) continue;
        if (!(await stat(file)).isFile()) {
          issues.push({ path: currentPath, message: 'SKILL.md deve apontar para um arquivo regular.' });
          continue;
        }

        const metadata = parseSkillMetadata(await readFile(file, 'utf8'), basename(directory));
        seenFiles.add(file);
        if (!skills.has(metadata.name)) {
          skills.set(metadata.name, { ...metadata, path: file, scope: root.scope });
        }
      } catch (error) {
        const code = errorCode(error);
        if (entry.isRoot && currentPath === entry.path && code === 'ENOENT') continue;
        issues.push({
          path: currentPath,
          message: typeof code === 'string'
            ? `Falha ao acessar caminho (${code}).`
            : error instanceof Error ? error.message : 'Falha na descoberta.',
        });
      }
    }
  }

  return { skills: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')), issues };
}
