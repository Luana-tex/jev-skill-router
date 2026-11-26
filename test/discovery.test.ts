import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverSkills } from '../src/discovery.js';

let temp: string;

beforeEach(async () => {
  temp = await realpath(await mkdtemp(join(tmpdir(), 'jev-skill-router-')));
});

afterEach(async () => {
  await rm(temp, { force: true, recursive: true });
});

async function writeSkill(path: string, name: string, description = 'Uma skill.') {
  const file = join(temp, path, 'SKILL.md');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n`);
  return file;
}

describe('discoverSkills', () => {
  it('lista skills aninhadas e prioriza o nome local em ordem determinística', async () => {
    await writeSkill('global/shared', 'shared', 'Global.');
    const global = await writeSkill('global/alpha', 'alpha');
    await writeSkill('local/b/shared', 'shared', 'Segunda.');
    const local = await writeSkill('local/a/shared', 'shared', 'Primeira.');
    await writeSkill('local/a/shared/assets/ignored', 'ignored');

    expect(await discoverSkills([
      { scope: 'global', path: join(temp, 'global') },
      { scope: 'local', path: join(temp, 'local') },
    ])).toEqual({
      skills: [
        { name: 'alpha', description: 'Uma skill.', path: global, scope: 'global' },
        { name: 'shared', description: 'Primeira.', path: local, scope: 'local' },
      ],
      issues: [],
    });
  });

  it('resolve aliases de diretório e arquivo, encerra ciclos e relata links quebrados', async () => {
    const external = await writeSkill('external/tool', 'tool');
    const local = join(temp, 'local');
    await mkdir(join(local, 'tool'), { recursive: true });
    await symlink(external, join(local, 'tool', 'SKILL.md'), 'file');
    await symlink(dirname(external), join(local, 'alias'), 'dir');
    await symlink(local, join(local, 'cycle'), 'dir');
    await symlink(join(temp, 'missing'), join(local, 'broken'), 'dir');

    const result = await discoverSkills([
      { scope: 'local', path: local },
      { scope: 'global', path: join(temp, 'external') },
    ]);

    expect(result.skills).toEqual([
      { name: 'tool', description: 'Uma skill.', path: external, scope: 'local' },
    ]);
    expect(result.issues).toEqual([
      { path: join(local, 'broken'), message: expect.stringContaining('ENOENT') },
    ]);
  });

  it('continua após metadados inválidos e aceita raízes ausentes', async () => {
    const invalid = await writeSkill('local/invalid', 'invalid', 'false');
    const valid = await writeSkill('local/valid', 'valid');
    const result = await discoverSkills([
      { scope: 'local', path: join(temp, 'local') },
      { scope: 'global', path: join(temp, 'absent') },
    ]);

    expect(result.skills).toMatchObject([{ path: valid, scope: 'local' }]);
    expect(result.issues).toEqual([
      { path: invalid, message: 'Metadados inválidos (description).' },
    ]);
  });

  it('lê um SKILL.md que é um link para um arquivo fora da raiz', async () => {
    const target = await writeSkill('external/tool', 'tool');
    const root = join(temp, 'local');
    const directory = join(root, 'tool');
    await mkdir(directory, { recursive: true });
    await symlink(target, join(directory, 'SKILL.md'), 'file');

    expect(await discoverSkills([{ path: root, scope: 'local' }])).toEqual({
      skills: [{ name: 'tool', description: 'Uma skill.', path: target, scope: 'local' }],
      issues: [],
    });
  });
});
