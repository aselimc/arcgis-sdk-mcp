import type Gadget from "../Gadget.js";

/** Options accepted by the PanelLayer constructor. */
export interface PanelLayerProperties {
  /**
   * Text shown above the panel rows.
   *
   * @default "Untitled"
   */
  heading?: string;
  /** Gadgets drawn by the layer, in drawing order. */
  gadgets?: Gadget[];
}

/**
 * A layer that arranges gadgets in rows. This is an invented class used by tests.
 *
 * @since 7.0
 * @example
 * ```ts
 * const layer = new PanelLayer({ heading: "Inventory" });
 * ```
 */
export default class PanelLayer {
  constructor(properties?: PanelLayerProperties);
  /** Text shown above the panel rows. */
  accessor heading: string;
  /** Number of rows currently laid out. */
  get rowCount(): number;
  /**
   * Recomputes the row layout.
   *
   * @param force Lay out again even when nothing changed.
   * @returns A promise that settles when the layout is drawn.
   */
  refresh(force?: boolean): Promise<void>;
}
