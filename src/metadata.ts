import { parse } from 'yaml';
import { z } from 'zod';

const metadataSchema = z.object({
  name: z.string().max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1).max(1024),
});

export type SkillMetadata = z.infer<typeof metadataSchema>;

export function parseSkillMetadata(markdown: string, directoryName: string): SkillMetadata {
  const frontmatter = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m.exec(markdown);
  if (frontmatter?.index !== 0 || frontmatter[1] === undefined) {
    throw new Error('Frontmatter YAML ausente ou incompleto.');
  }

  let data: unknown;
  try {
    data = parse(frontmatter[1], { maxAliasCount: 0 });
  } catch {
    throw new Error('Frontmatter YAML inválido.');
  }

  const result = metadataSchema.safeParse(data);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0] ?? 'frontmatter'))];
    throw new Error(`Metadados inválidos (${fields.join(', ')}).`);
  }
  if (result.data.name !== directoryName) {
    throw new Error('O nome da skill deve corresponder ao nome do diretório.');
  }
  return result.data;
}
