import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { installationDirectory, resolveCodexCredentials } from './codex-config.js';
import { JevError } from './decision/jev-error.js';

async function canRead(path: string) {
  return access(path, constants.R_OK).then(() => true, () => false);
}

export async function codexDoctor() {
  const skill = join(installationDirectory, 'codex', 'jev-skill-router');
  const launcher = join(skill, 'scripts', 'recommend.mjs');
  const globalSkill = join(homedir(), '.agents', 'skills', 'jev-skill-router');
  const [manifestReadable, launcherReadable, buildReadable, installedTarget, expectedTarget, credentials] = await Promise.all([
    canRead(join(skill, 'SKILL.md')),
    canRead(launcher),
    canRead(join(installationDirectory, 'dist', 'cli.js')),
    realpath(globalSkill).catch(() => undefined),
    realpath(skill).catch(() => undefined),
    resolveCodexCredentials().then(
      ({ source }) => ({ status: 'configured', source }),
      (error: unknown) => ({ status: error instanceof JevError ? error.code : 'invalid-credentials-config' }),
    ),
  ]);

  return {
    nodeVersion: process.versions.node,
    installation: {
      manifestReadable, launcherReadable, buildReadable,
      globalSkill: !installedTarget ? 'missing-or-unreadable'
        : installedTarget === expectedTarget ? 'matches-installation' : 'different-installation',
    },
    disabled: process.env.JEV_SKILL_ROUTER_DISABLED === '1',
    credentials,
    network: 'not-checked',
    authentication: 'not-checked',
  };
}
