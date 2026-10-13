_class_ · `tides.harbour`

# TideClock

```python
class tides.harbour.TideClock(harbour, units='m')
```

The `TideClock` class follows the tides of one harbour. Readings come from a [`Gauge`](https://developers.arcgis.com/tides-python/api-reference/tides.gauge.html#tides.gauge.Gauge).

> **Note:** Times are reported in UTC.

```python
clock = TideClock("brest")
clock.next_high_tide()
```

## Methods

### `next_high_tide`

```python
next_high_tide(after: datetime | None = None)
```

The `next_high_tide` method finds the next high tide. It never looks back.

- Parameter: Description
- after: Optional datetime. Search from this moment; defaults to now.

**Returns:** A datetime in UTC.

## Properties

### units

```python
property units
```

The unit of every reported height.
