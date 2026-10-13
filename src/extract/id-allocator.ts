/**
 * Hands out section ids that are unique within one page. A repeated id gets `-1`, `-2`, ...
 * in document order, as `sectionsFromMarkdown` numbers them; unlike a plain counter, a
 * suffixed id never collides with an id the page itself uses (`parameters-1`).
 */
export class IdAllocator {
  private readonly used = new Set<string>();
  private readonly counts = new Map<string, number>();

  /** Marks an id as taken without handing it out. */
  reserve(id: string): void {
    this.used.add(id);
  }

  /** `base` when it is free, else the first free `base-<n>`. */
  next(base: string): string {
    let count = this.counts.get(base) ?? 0;
    let id = base;
    while (this.used.has(id)) {
      count += 1;
      id = `${base}-${count}`;
    }
    this.counts.set(base, count);
    this.used.add(id);
    return id;
  }
}
