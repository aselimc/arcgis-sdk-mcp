import type Beam from "./Beam.js";
import type Keeper from "./staff/Keeper.js";
import type { BeamProperties } from "./Beam.js";
import type { Collection } from "./core/Collection.js";
import type { EventedAccessor } from "./core/Evented.js";
import type { LampMixin, LampMixinProperties, LampMixinEvents } from "./support/LampMixin.js";
import type { SignalOptions } from "./types.js";

/** Options accepted by the {@link Lighthouse} constructor. */
export interface LighthouseProperties extends LampMixinProperties, Partial<Pick<Lighthouse, "height" | "name">> {
  /**
   * The beam the lighthouse shows. A plain object is turned into a
   * [Beam](https://example.com/references/core/Beam/).
   *
   * @default null
   * @since 1.2
   */
  beam?: BeamProperties | null;
  /**
   * Identifier of the stored lamp profile to start from. It is read once and is
   * not available afterwards.
   */
  profileId?: string;
}

export interface LighthouseEvents extends LampMixinEvents {
  /** Fires when the lamp is switched on or off. */
  "lamp-change": { lit: boolean };
}

/**
 * A lighthouse stands on a headland and shows a [beam](https://example.com/references/core/Lighthouse/#beam).
 * Add keepers with {@link Lighthouse.addKeeper}.
 *
 * ## Choosing a height
 *
 * Taller towers are seen from further away.
 *
 * ```js
 * const tower = new Lighthouse({ height: 32 });
 * ```
 *
 * > [!WARNING]
 * >
 * > A tower without a lamp is only a tower.
 *
 * @since 1.0
 * @see [Sample - First light](https://example.com/sample-code/first-light/)
 * @see [Beam](https://example.com/references/core/Beam/)
 */
export default class Lighthouse extends __LighthouseSansType {
  /** The kind of structure, for checks that need no import. */
  get type(): "lighthouse";
}
export abstract class __LighthouseSansType extends LighthouseSuperclass {
  /**
   * @deprecated
   * Do not reference this property.
   * Use the helpers from \@example/core/Evented
   */
  "@eventTypes": LighthouseEvents;
  /**
   * @example
   * // Typical usage
   * const tower = new Lighthouse({
   *   name: "Eddystone"
   * });
   */
  constructor(properties?: LighthouseProperties);
  /**
   * The beam the lighthouse shows.
   *
   * @since 1.2
   */
  get beam(): Beam | null | undefined;
  set beam(value: BeamProperties | null | undefined);
  /**
   * Height of the tower above ground, in metres.
   *
   * @default 20
   */
  accessor height: number;
  /** Everyone who has kept this lighthouse. */
  get keepers(): Collection<Keeper>;
  /** Display name. */
  accessor name: string | null | undefined;
  /**
   * Names of the sea areas the light covers.
   *
   * @since 1.3
   */
  readonly areas?: string[] | null;
  /** How many lighthouses exist. */
  static count: number;
  private _lamp;
  /**
   * Adds a keeper to {@link Lighthouse.keepers | the list}.
   *
   * @param keeper - The keeper to add.
   * @param options - How to announce the change.
   * @param options.silent - Do not emit an event.
   * @returns The keeper that was added.
   * @since 1.1
   * @example
   * tower.addKeeper(keeper);
   * @example
   * ```ts
   * tower.addKeeper(keeper, { silent: true });
   * ```
   */
  addKeeper(keeper: Keeper, options?: SignalOptions): Keeper;
  /**
   * Measures the range of the light.
   *
   * @param weather Sky condition at the time of measurement.
   * @returns Range and the height it was measured at.
   * @throws When the lamp is off.
   * @see [Range tables](https://example.com/range/)
   */
  measureRange(weather?: "clear" | "fog"): Promise<{
      range: number;
      height: number | null;
  }>;
  /**
   * Switches the lamp off.
   *
   * @deprecated since 1.4. Use {@link Lighthouse.beam} instead.
   */
  extinguish(): void;
  /** @internal */
  _rebuild(): void;
}
declare const LighthouseSuperclass: typeof EventedAccessor & typeof LampMixin
