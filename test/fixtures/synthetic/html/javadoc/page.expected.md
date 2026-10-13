# Class HarborChart

Package [com.example.harbor.mapping](https://docs.example.com/java/api/com.example.harbor/com/example/harbor/mapping/package-summary.html)

**Inheritance:** `java.lang.Object` → `com.example.harbor.mapping.HarborChart`

- **All Implemented Interfaces:** [`Loadable`](https://docs.example.com/java/api/com.example.harbor/com/example/harbor/Loadable.html)

```java
public final class HarborChart extends Object implements Loadable
```

A chart is a container for layers. Give it to a chart view to draw it.

- **Since:** 2.1.0

## Method Summary

| Modifier and Type | Method | Description |
| --- | --- | --- |
| `double` | `getMaxScale()` | Gets the largest scale the chart can be shown at. |
| `void` | `setMaxScale(double maxScale)` | Sets the largest scale the chart can be shown at. |

**Methods inherited from class java.lang.Object:** `equals, hashCode, toString`

## Constructor Details

### HarborChart

```java
public HarborChart(Basemap basemap)
```

Creates a chart on top of a basemap.

- **Parameters:** `basemap` - the basemap drawn under all layers
- **Throws:** [`IllegalArgumentException`](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/IllegalArgumentException.html) - if basemap is null

## Method Details

### getMaxScale

```java
public double getMaxScale()
```

Gets the largest scale the chart can be shown at. Zero means there is no limit.

- **Returns:** the largest scale

### setMaxScale

```java
public void setMaxScale(double maxScale)
```

**Deprecated.**

Use the scale range of the view.

Sets the largest scale the chart can be shown at.
