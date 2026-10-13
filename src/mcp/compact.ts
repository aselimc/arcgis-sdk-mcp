/**
 * Dropping `undefined` properties. Results are JSON, where an absent property and an
 * `undefined` one differ for schema validation and for `exactOptionalPropertyTypes`.
 */

type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];

/** `T` with every property that may be `undefined` turned into an optional one. */
export type Compact<T> = { [K in Exclude<keyof T, OptionalKeys<T>>]: T[K] } & {
  [K in OptionalKeys<T>]?: Exclude<T[K], undefined>;
};

/** A shallow copy of `value` without the properties whose value is `undefined`. */
export function compact<T extends object>(value: T): Compact<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Compact<T>;
}
