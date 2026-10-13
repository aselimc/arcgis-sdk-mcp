/**
 * Typings for `@joplin/turndown-plugin-gfm`, which ships none. Only the plugin functions are
 * declared; each one is passed to `TurndownService.use`.
 */
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  /** Strikethrough, tables, task list items and highlighted code blocks together. */
  export const gfm: TurndownService.Plugin;
  /** GFM tables only. Tables with block content are kept as HTML. */
  export const tables: TurndownService.Plugin;
  /** `<del>`, `<s>` and `<strike>` as `~~text~~`. */
  export const strikethrough: TurndownService.Plugin;
  /** Checkbox list items as `[ ]` / `[x]`. */
  export const taskListItems: TurndownService.Plugin;
  /** GitHub `div.highlight-source-<lang> > pre` blocks as fences. */
  export const highlightedCodeBlock: TurndownService.Plugin;
}
