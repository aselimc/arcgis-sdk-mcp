_Class_ · Tides · iOS 17.0+, visionOS 2.0+ (beta)

# TideClock

Tracks tide times for one harbour. Pair it with a `GaugeView`.

```swift
final class TideClock
```

## Parameters

- `harbour`: The harbour to follow. Pass `nil` for the nearest one.

## Overview

A clock reads from a [`Harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour) and follows the [Getting started](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/gettingstarted) article. It is _not_ thread-safe; see `Swift.Sendable` and the [tide primer](https://example.com/tides).

- **High** tides are reported first.
- Low tides follow.

```swift
let clock = TideClock(harbour: .brest)
print(clock.nextHighTide)
```

> **Since:** 2.1

> **Warning:**
>
> Times are in UTC.
>
> Convert before display.

| Unit | Meaning |
| --- | --- |
| `m` | Metres |

1. Create it.
2. Read it.

- **Spring tide**: The largest range.

A node type nobody has seen yet.

## Topics

### Initializers

- [`init(harbour: Harbour?)`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/tideclock/init(harbour:)): Creates a clock for a [`Harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour).

### Instance Properties

- [`var nextHighTide: Date`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/tideclock/nexthightide): Time of the next high tide.

## Relationships

### Conforms To

- `Swift.Sendable`

## See Also

### Harbours

- [`struct Harbour`](https://developers.arcgis.com/tides-swift/api-reference/documentation/tides/harbour)
