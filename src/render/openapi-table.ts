/**
 * Property tables and link unwrapping for the OpenAPI renderer.
 */
import type { RenderMeta } from '../core/ports.js';
import { fence, inlineCode, table } from './md.js';
import type { OaProperty } from './openapi-model.js';

/** Turns the `%%[Name](/path)%%` link syntax of page data into Markdown links. */
export type Linker = (text: string) => string;

/**
 * Page data writes links to type pages as `%%[Name](/path)%%`, relative to the Gatsby site
 * (`/rest`), and arrays as `[%%[Name](/path)%%]`. Both become ordinary Markdown.
 */
export function linker(meta: RenderMeta, sitePrefix: string | undefined): Linker {
  let origin = '';
  try {
    origin = new URL(meta.url).origin;
  } catch {
    // A non-URL ref (never the case for page data) leaves site-relative links relative.
  }
  const prefix = (sitePrefix ?? '').replace(/^\/?/, '/').replace(/\/$/, '');
  const link = (name: string, path: string): string =>
    `[${name}](${/^https?:/.test(path) ? path : `${origin}${prefix}${path}`})`;
  return (text) =>
    text
      .replace(
        /\[%%\[([^\]]+)\]\(([^)]+)\)%%\]/g,
        (_w, name: string, path: string) => `${link(name, path)}[]`,
      )
      .replace(/%%\[([^\]]+)\]\(([^)]+)\)%%/g, (_w, name: string, path: string) => link(name, path))
      .replace(/%%/g, '');
}

function typeCell(property: OaProperty, links: Linker): string {
  const shown = property.displayType ?? property.type;
  if (shown === undefined) return '';
  if (shown.includes('%%')) {
    const linked = links(shown);
    return property.type === undefined || property.type === 'object' || property.type === 'array'
      ? linked
      : `${linked} (${property.type})`;
  }
  // Page data writes an array of a primitive as `[string]`.
  return inlineCode(shown.replace(/^\[(.+)\]$/, '$1[]'));
}

function descriptionCell(property: OaProperty, links: Linker): string {
  const facts = [
    property.deprecated === true ? '**Deprecated.**' : undefined,
    property.default === undefined ? undefined : `Default ${inlineCode(property.default)}.`,
    property.constraints.length === 0
      ? undefined
      : `Constraints: ${property.constraints.join('; ')}.`,
    property.example === undefined ? undefined : `Example: ${inlineCode(property.example)}.`,
  ].filter((fact) => fact !== undefined);
  return [links((property.description ?? '').trim()), ...facts]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');
}

/** Rows of a property table; nested properties follow their parent under a dotted name. */
function rows(properties: readonly OaProperty[], links: Linker, parent = ''): string[][] {
  return properties.flatMap((property) => {
    const array = property.type === 'array' || /^\[.*\]$|\[\]$/.test(property.displayType ?? '');
    const name = `${parent}${property.name}`;
    return [
      [
        inlineCode(name),
        typeCell(property, links),
        property.required === true ? 'yes' : property.required === false ? 'no' : '',
        descriptionCell(property, links),
      ],
      ...rows(property.properties, links, `${name}${array ? '[]' : ''}.`),
    ];
  });
}

/**
 * A table of parameters or properties: name, type, whether it is required, and a
 * description that ends with the default, the constraints and an example value. Empty when
 * there are no properties.
 *
 * @param label heading of the first column (`Name` for parameters, `Property` for fields).
 */
export function propertyTable(
  label: string,
  properties: readonly OaProperty[],
  links: Linker,
): string {
  return table([label, 'Type', 'Required', 'Description'], rows(properties, links));
}

/** An example value as a fence: `json` when it parses as JSON, `text` for a bare value. */
export function jsonExample(example: string): string {
  let language = 'json';
  try {
    JSON.parse(example);
  } catch {
    language = 'text';
  }
  return fence(example, language);
}
