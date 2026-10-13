# Tide functions

## MeanLevel

_constant · bundle `core` · since 1.0_

The mean water level, in metres.

## `TideHeight(moment) -> Number`

_function · bundle `core` · since 1.4_

Returns the water height at a moment.

**Parameter**

- **moment**: [Date](https://example.com/arcade/guide/types/#date) - The moment to look up.

**Return value**: [Number](https://example.com/arcade/guide/types/#number)

**Examples**

Height right now

```arcade
TideHeight(Now())
```

Height tomorrow

```arcade
TideHeight(DateAdd(Now(), 1, 'days'))
```

## `TideHeight(moments) -> Array<Number>`

_function · bundle `data-access` · since 1.9 · consumes credits_

Returns the water heights at several moments.

**Parameter**

- **moments**: [Array](https://example.com/arcade/guide/types/#array)<[Date](https://example.com/arcade/guide/types/#date)> - The moments to look up.

**Return value**: [Array](https://example.com/arcade/guide/types/#array)<[Number](https://example.com/arcade/guide/types/#number)>

**Example**

```arcade
TideHeight([Now(), Today()])
```
