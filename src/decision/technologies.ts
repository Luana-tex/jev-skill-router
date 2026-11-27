import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const dependencies = z.record(z.string(), z.unknown());
const manifest = z.object({
  dependencies: dependencies.optional(),
  devDependencies: dependencies.optional(),
  peerDependencies: dependencies.optional(),
});

const knownTechnologies = {
  react: 'React', next: 'Next.js', vue: 'Vue', nuxt: 'Nuxt', svelte: 'Svelte',
  '@angular/core': 'Angular', typescript: 'TypeScript', vitest: 'Vitest', jest: 'Jest',
  express: 'Express', tailwindcss: 'Tailwind CSS',
};

export async function projectTechnologies(directory: string, explicit: readonly string[] = []) {
  const inferred: string[] = [];
  try {
    const config = manifest.parse(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')));
    const names = new Set(Object.values(config).flatMap((group) => Object.keys(group ?? {})));
    for (const [dependency, technology] of Object.entries(knownTechnologies)) {
      if (names.has(dependency)) inferred.push(technology);
    }
  } catch {
    // An absent or unreadable manifest leaves only explicitly supplied technology labels.
  }
  return [...new Set([...inferred, ...explicit])].sort();
}
