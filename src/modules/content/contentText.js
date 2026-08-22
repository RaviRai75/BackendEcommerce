export const CONTENT_LIMITS = Object.freeze({
  title: 160,
  summary: 500,
  sections: 20,
  heading: 160,
  paragraphsPerSection: 20,
  paragraph: 2000,
  bulletsPerSection: 30,
  bullet: 500,
  totalCharacters: 20_000,
});

// Plain text may contain punctuation and line breaks, but never executable or
// formatting syntax. Structure is represented by the schema, not markup.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML = /<|>|&(?:lt|gt|#0*60|#x0*3c);/i;
const MARKDOWN_BLOCK = /^\s{0,3}(?:#{1,6}\s|>|[-+*]\s|\d+\.\s|```|~~~)/m;
const MARKDOWN_INLINE = /!\[|\[[^\]]+\]\([^)]*\)|\*\*|__|`{1,3}/;
const ACTIVE_CONTENT = /(?:javascript\s*:|data\s*:\s*text\/html|@import\b)/i;

export function isStructuredPlainText(value) {
  return (
    typeof value === "string" &&
    !CONTROL_CHARACTERS.test(value) &&
    !HTML.test(value) &&
    !MARKDOWN_BLOCK.test(value) &&
    !MARKDOWN_INLINE.test(value) &&
    !ACTIVE_CONTENT.test(value)
  );
}

export function contentCharacterCount(content) {
  return [
    content?.title,
    content?.summary,
    ...(content?.sections ?? []).flatMap((section) => [
      section?.heading,
      ...(section?.paragraphs ?? []),
      ...(section?.bullets ?? []),
    ]),
  ].reduce(
    (total, value) => total + (typeof value === "string" ? value.length : 0),
    0,
  );
}
