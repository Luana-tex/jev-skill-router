import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({
  createdAt: z.number().int().nonnegative(),
  baselineCalls: z.number().int().nonnegative(),
  selected: z.array(z.object({ index: z.number().int().nonnegative(), relevance: z.number().min(0).max(1) })),
});

type Entry = z.infer<typeof entrySchema>;

function hasCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function createSelectionCache(baseDirectory: string, ttlMs: number) {
  const directory = join(baseDirectory, 'jev-skill-router-cache-v1');
  const secretPath = join(directory, 'key');

  async function keyFor(input: unknown) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let secret: Buffer;
    try {
      secret = await readFile(secretPath);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
      const temporary = join(directory, `key.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, randomBytes(32), { mode: 0o600, flag: 'wx' });
        await link(temporary, secretPath).catch((error: unknown) => {
          if (!hasCode(error, 'EEXIST')) throw error;
        });
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      secret = await readFile(secretPath);
    }
    if (secret.length !== 32) throw new Error('Chave local do cache inválida.');
    return createHmac('sha256', secret).update(JSON.stringify(input)).digest('hex');
  }

  return {
    async entry(input: unknown) {
      const key = await keyFor(input);
      const path = join(directory, `${key}.json`);
      return {
        async read() {
          try {
            const entry = entrySchema.parse(JSON.parse(await readFile(path, 'utf8')));
            const age = Date.now() - entry.createdAt;
            return age >= 0 && age < ttlMs ? entry : undefined;
          } catch (error) {
            if (hasCode(error, 'ENOENT') || error instanceof SyntaxError || error instanceof z.ZodError) return undefined;
            throw error;
          }
        },
        async write(entry: Omit<Entry, 'createdAt'>) {
          const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
          try {
            await writeFile(temporary, JSON.stringify({ ...entry, createdAt: Date.now() }), {
              mode: 0o600, flag: 'wx',
            });
            await rename(temporary, path);
          } finally {
            await unlink(temporary).catch(() => undefined);
          }
        },
      };
    },
    async clear() {
      const files = await readdir(directory).catch((error: unknown) => {
        if (hasCode(error, 'ENOENT')) return [];
        throw error;
      });
      const entries = files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
      await Promise.all(entries.map((name) => unlink(join(directory, name)).catch((error: unknown) => {
        if (!hasCode(error, 'ENOENT')) throw error;
      })));
      return entries.length;
    },
  };
}
