_Class_ in `tides` · [source](https://github.com/example/tides/blob/0123abc/packages/tides/src/TideClock.ts#L12)

# TideClock

```ts
class TideClock extends ClockBase implements Disposable
```

_since 2.1.0_

**Extended by:** `StormClock`

Keeps track of tide times for one harbour. Create it with [`TideClock.forHarbour`](https://developers.arcgis.com/tides-js/api-reference/tides/TideClock/#forHarbour) and read [nextHighTide()](https://developers.arcgis.com/tides-js/api-reference/tides/TideClock/#nextHighTide).

See the [tide primer](https://example.com/tides/primer) and `HarbourOptions`.

**Example**

```ts
const clock = TideClock.forHarbour("brest");
```

## Constructors

### constructor

```ts
constructor(options: HarbourOptions)
```

**Parameters**

- `options` (`HarbourOptions`): Where and how to measure.

## Properties

### harbour

```ts
readonly harbour: string
```

Identifier of the harbour.

### units

```ts
units?: "m" | "ft" = "m"
```

Unit of every height this clock reports.

## Accessors

### nextHighTide

```ts
get nextHighTide(): Date
```

Time of the next high tide.

### offset

```ts
get offset(): number
set offset(value: number)
```

Minutes added to every time.

## Methods

### forHarbour

```ts
static forHarbour(id: string): TideClock
```

Creates a clock for a known harbour.

**Parameters**

- `id` (`string`): Harbour identifier.

**Returns:** A clock that is ready to use.

**Throws**

- When the harbour is unknown.

### heightAt

```ts
heightAt(when: Date, precision?: number): number
```

_inherited from ClockBase_

> **Deprecated:** Use [sample](https://developers.arcgis.com/tides-js/api-reference/tides/TideClock/#sample) instead.

Water height at a moment. Uses `offset`.

**Parameters**

- `when` (`Date`)
- `precision` (`number`, optional, default `2`)

**Example**

```ts
clock.heightAt(new Date());
```

### sample

```ts
sample<T extends Date>(...moments: T[]): Promise<(number | null)[]>
sample(range: { from: Date; to?: Date }): Promise<number[]>
```

Heights at several moments.

**Parameters**

- `moments` (`T[]`)
