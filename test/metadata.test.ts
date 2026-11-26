import { describe, expect, it } from 'vitest';
import { parseSkillMetadata } from '../src/metadata.js';

describe('parseSkillMetadata', () => {
  it('lê YAML multilinha com BOM e CRLF e ignora o corpo', () => {
    const markdown = '\uFEFF---\r\nname: example\r\ndescription: >\r\n  Primeira linha.\r\n  Segunda linha.\r\nlicense: MIT\r\n---\r\nTexto livre.';
    expect(parseSkillMetadata(markdown, 'example')).toEqual({
      name: 'example',
      description: 'Primeira linha. Segunda linha.',
    });
  });

  it.each([
    ['ausente', '# Skill\n---\nname: example\n---'],
    ['incompleto', '---\nname: example'],
    ['YAML inválido', '---\nname: [\n---'],
    ['chave duplicada', '---\nname: example\nname: example\ndescription: ok\n---'],
    ['nome ausente', '---\ndescription: ok\n---'],
    ['nome inválido', '---\nname: example--tool\ndescription: ok\n---'],
    ['nome divergente', '---\nname: other\ndescription: ok\n---'],
    ['descrição vazia', '---\nname: example\ndescription: " "\n---'],
    ['descrição não textual', '---\nname: example\ndescription: [text]\n---'],
    ['descrição longa', `---\nname: example\ndescription: ${'x'.repeat(1025)}\n---`],
  ])('rejeita frontmatter com %s', (_label, markdown) => {
    expect(() => parseSkillMetadata(markdown, 'example')).toThrow();
  });
});
