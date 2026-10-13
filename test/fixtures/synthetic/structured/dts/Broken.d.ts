/**
 * A buoy marks a channel.
 *
 * @since 2.0
 */
export default class Buoy {
  /** Colour of the buoy. */
  accessor colour: string;
  /**
   * Where the buoy is moored. The declaration below lost its closing bracket.
   */
  mooring(options: { depth: number; ): Promise<void>;
  /**
   * Sounds the bell.
   *
   * @param times How often to ring.
   */
  ring(times: number): void;
  /** Whether the lamp is lit. */
  get lit(): boolean;
