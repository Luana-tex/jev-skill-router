import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCodexCredentials } from '../src/codex-config.js';

let root: string;
let install: string;
let config: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jev-codex-config-'));
  install = join(root, 'installation');
  config = join(root, '.config', 'jev-skill-router');
  await Promise.all([mkdir(install), mkdir(config, { recursive: true })]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function credentials(file: string, key: string, mode = 0o600) {
  return writeFile(file, `TYPESAFE_API_KEY=${key}\nIGNORED_SETTING=unrelated\n`, { mode });
}

describe('resolveCodexCredentials', () => {
  it('prioritizes the environment, explicit file, global file and installation file', async () => {
    const explicit = join(root, 'override.env');
    await Promise.all([
      credentials(explicit, 'explicit-key'),
      credentials(join(config, '.env'), 'global-key'),
      credentials(join(install, '.env'), 'installation-key'),
    ]);

    expect(await resolveCodexCredentials({ TYPESAFE_API_KEY: 'exported', JEV_SKILL_ROUTER_ENV_FILE: explicit }, install, root))
      .toEqual({ source: 'environment', key: 'exported' });
    expect(await resolveCodexCredentials({ JEV_SKILL_ROUTER_ENV_FILE: explicit }, install, root))
      .toEqual({ source: 'configured-file', key: 'explicit-key' });
    expect(await resolveCodexCredentials({}, install, root)).toEqual({ source: 'global-file', key: 'global-key' });
    await rm(join(config, '.env'));
    expect(await resolveCodexCredentials({}, install, root)).toEqual({ source: 'installation-file', key: 'installation-key' });
  });

  it('rejects relative overrides and restrictive-file violations without falling through', async () => {
    await credentials(join(install, '.env'), 'installation-key');
    await expect(resolveCodexCredentials({ JEV_SKILL_ROUTER_ENV_FILE: '.env' }, install, root))
      .rejects.toMatchObject({ code: 'invalid-credentials-config' });
    if (process.getuid) {
      await credentials(join(config, '.env'), 'unsafe-key', 0o644);
      await expect(resolveCodexCredentials({}, install, root)).rejects.toMatchObject({ code: 'invalid-credentials-config' });
    }
  });

  it('distinguishes missing keys from invalid credential values', async () => {
    await expect(resolveCodexCredentials({}, install, root)).rejects.toMatchObject({ code: 'missing-credentials' });
    await expect(resolveCodexCredentials({ TYPESAFE_API_KEY: 'bad key with whitespace' }, install, root))
      .rejects.toMatchObject({ code: 'invalid-credentials-format' });
  });
});
