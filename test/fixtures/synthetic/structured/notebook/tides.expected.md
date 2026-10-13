# Reading a tide gauge

This notebook loads one day of readings. See the [data notes](https://github.com/example/tides/blob/main/samples/data/README.md).

```python
from tides import TideClock

clock = TideClock("brest")
```

## Next high tide

Ask the clock:

```python
clock.next_high_tide()
```

Output:

```text
datetime.datetime(2026, 10, 14, 5, 12)
```

```python
readings = clock.load()
readings.plot()
```

Output:

```text
loaded 96 readings
```

```python
print(readings)
```
