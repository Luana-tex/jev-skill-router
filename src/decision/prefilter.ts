const exactReply = /^(?:responda exatamente com|reply exactly with) "[\p{L}\p{N} _-]{1,40}"[.!]?$/iu;
const arithmetic = /^(?:calcule|calculate) \d{1,6} (?:\+|-) \d{1,6}[.!?]?$/iu;
const typoCorrection = [
  /^(?:corrija|corrigir|conserte|consertar) (?:um|o) (?:erro de digitação|typo) (?:no|na|em) (?:arquivo )?(?<target>.+)$/iu,
  /^(?:fix|correct) (?:a|one|the) (?:typo|typing error) in (?:the )?(?<target>.+)$/iu,
];
const documentationFile = /^(?:(?:readme|changelog|contributing)(?:\.md)?|(?:docs\/)?[a-z0-9_-]+\.md)$/i;

export function localTaskReason(task: string, skillNames: ReadonlySet<string>) {
  // Catalog names are canonical slugs. A mention can be an explicit request,
  // so leave any overlap with these narrow grammars to the judgment engine.
  const words = task.toLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
  if (words.some((word) => skillNames.has(word))) return undefined;

  if (exactReply.test(task) || arithmetic.test(task)) return 'mechanical-task';
  for (const pattern of typoCorrection) {
    const target = pattern.exec(task)?.groups?.target;
    if (!target) continue;
    const file = target.replace(/\.$/, '').replace(/^(?:`([^`]+)`|"([^"]+)")$/, '$1$2');
    if (documentationFile.test(file)) return 'documentation-typo';
  }
  return undefined;
}
