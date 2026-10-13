_Type_ · namespace `Example.Tides` · assembly `Example.Tides`

# TideClock

```csharp
Example.Tides.TideClock
```

Follows the tides of one harbour. Create it with `TideClock(string)`.

Readings come from a `Gauge`.

Supported units:

- `m` for metres
- **ft**: for feet

**Example**

Reading the next high tide:

```csharp
var clock = new TideClock("brest");

Console.WriteLine(clock.NextHighTide);
```

**See also**

- [Tide primer](https://example.com/tides)

## Constructors

### TideClock

```csharp
TideClock(string harbour)
```

Creates a clock for a harbour.

**Parameters**

- `harbour` (`string`): Identifier of the harbour.

**Throws**

- `ArgumentException`: The harbour is unknown.

## Properties

### NextHighTide

```csharp
TideClock.NextHighTide
```

Time of the next high tide.

**Value:** A UTC time.

### Item

```csharp
TideClock.this[int]
```

The reading at an index.

## Methods

### `Sample<M0>`

```csharp
TideClock.Sample<M0>(IEnumerable<M0> moments, int? precision, ref double[] heights)
```

Heights at several moments. Uses `precision` digits and returns `null` for moments outside the record.

**Type parameters**

- `T`: The moment type.

**Parameters**

- `moments` (`IEnumerable<M0>`): The moments to sample.
- `precision` (`int?`): Digits after the decimal point.
- `heights` (`ref double[]`): Receives the heights.

**Returns:** **true** when every moment was found.

## Events

### Turned

```csharp
TideClock.Turned
```

Raised when the tide turns.

## Fields

### DefaultUnits

```csharp
TideClock.DefaultUnits
```

The unit used when none is given.
