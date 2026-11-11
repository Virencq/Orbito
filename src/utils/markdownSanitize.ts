import { defaultSchema } from 'rehype-sanitize'

// Keep the default HTML allowlist, but constrain classes accepted from raw HTML.
export const safeMarkdownSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [['className', /^language-/, 'math-inline', 'math-display']],
    span: [['className', /^(?:katex|shiki)(?:-.+)?$/]],
  },
}
