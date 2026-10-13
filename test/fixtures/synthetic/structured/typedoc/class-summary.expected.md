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

- `constructor`

## Properties

- `harbour` _(readonly)_: Identifier of the harbour.
- `units`: Unit of every height this clock reports.

## Accessors

- `nextHighTide` _(readonly)_: Time of the next high tide.
- `offset`: Minutes added to every time.

## Methods

- `forHarbour`: Creates a clock for a known harbour.
- `heightAt` _(inherited from ClockBase, deprecated)_: Water height at a moment.
- `sample`: Heights at several moments.
