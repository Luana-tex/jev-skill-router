import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { JevError } from './decision/jev-error.js';

export const installationDirectory = fileURLToPath(new URL('../', import.meta.url));

function formatKey(value: string) {
  const key = value.trim();
  if (!/^[!-~]+$/.test(key)) throw new JevError('invalid-credentials-format');
  return key;
}

async function readKeyFile(path: string, optional: boolean) {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch((error: unknown) => {
    if (optional && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new JevError('invalid-credentials-config');
  });
  if (!file) return undefined;

  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 * 1024
        || (process.getuid && (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) {
      throw new JevError('invalid-credentials-config');
    }
    const key = parseEnv(await file.readFile('utf8')).TYPESAFE_API_KEY;
    if (!key?.trim()) throw new JevError('missing-credentials');
    return formatKey(key);
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError('invalid-credentials-config');
  } finally {
    await file.close();
  }
}

export async function resolveCodexCredentials(
  env: NodeJS.ProcessEnv = process.env,
  installDir = installationDirectory,
  userHome = homedir(),
) {
  if (env.TYPESAFE_API_KEY?.trim()) return { source: 'environment', key: formatKey(env.TYPESAFE_API_KEY) } as const;
  const explicitPath = env.JEV_SKILL_ROUTER_ENV_FILE;
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) throw new JevError('invalid-credentials-config');
    return { source: 'configured-file', key: await readKeyFile(explicitPath, false) } as const;
  }

  const configHome = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(userHome, '.config');
  const globalKey = await readKeyFile(join(configHome, 'jev-skill-router', '.env'), true);
  if (globalKey) return { source: 'global-file', key: globalKey } as const;

  const installationKey = await readKeyFile(join(installDir, '.env'), true);
  if (installationKey) return { source: 'installation-file', key: installationKey } as const;
  throw new JevError('missing-credentials');
}
