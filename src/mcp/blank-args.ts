/**
 * Blank arguments. A model that fills every property of a tool schema (strict structured
 * tool calling does) sends `""` or `null` where it means "not given". Each tool would have
 * to handle that for each argument, and they did so differently: an empty `product` was an
 * unknown product in one tool and no product in another, an empty `cursor` was an expired
 * cursor, an empty `version` selected another source. The arguments are therefore
 * normalised once, before validation, for all tools, and in the same way for the prompts,
 * whose arguments a host collects in a form that sends `""` for a field left empty.
 */
import * as z from 'zod/v4';

/** The arguments of `schema` that a caller may leave out: optional ones and ones with a default. */
function omissibleKeys(schema: z.ZodObject): ReadonlySet<string> {
  // The default shape type of `ZodObject` is loose (`any` per property).
  const shape: Readonly<Record<string, z.ZodType>> = schema.shape;
  return new Set(
    Object.entries(shape)
      .filter(([, property]) => property.safeParse(undefined).success)
      .map(([key]) => key),
  );
}

/**
 * `args` as the caller meant them: every string trimmed, and every argument that may be
 * left out removed when it is `null`, empty or whitespace only. A required argument is kept
 * as trimmed, so that its own validation reports it. Anything that is not an object of
 * arguments is returned unchanged, for the schema to reject.
 */
export function withoutBlanks(omissible: ReadonlySet<string>, args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args)
      .map(([key, value]): [string, unknown] => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ])
      .filter(([key, value]) => !(omissible.has(key) && (value === '' || value === null))),
  );
}

/**
 * `schema` with {@link withoutBlanks} applied before validation.
 *
 * The JSON Schema a host is shown is that of `schema` itself: zod describes a preprocessed
 * schema by its inner schema, so the published tool surface does not change.
 */
export function blankTolerant<I extends z.ZodObject>(schema: I): z.ZodType<z.output<I>> {
  const omissible = omissibleKeys(schema);
  return z.preprocess((args) => withoutBlanks(omissible, args), schema);
}
