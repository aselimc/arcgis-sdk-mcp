`com.example.harbor.mapping.HarborChart`

# HarborChart

```kotlin
class HarborChart : ChartModel
```

A chart is a container for layers. Give it to a chart view to draw it.

**Since:** 2.1.0

#### Parameters

- `tideDatum`: The level that depths are measured from.

#### See also

- [ChartModel.layers](https://docs.example.com/kotlin/api/harbor-maps-kotlin/com.example.harbor.mapping/-chart-model/layers.html)

## Constructors

#### [HarborChart](https://docs.example.com/kotlin/api/harbor-maps-kotlin/com.example.harbor.mapping/-harbor-chart/-harbor-chart.html)

```kotlin
constructor(basemap: Basemap)
```

Creates a chart on top of a basemap.

```kotlin
constructor(item: Item)
```

Creates a chart from a stored item.

## Properties

#### [backgroundColor](https://docs.example.com/kotlin/api/harbor-maps-kotlin/com.example.harbor.mapping/-harbor-chart/background-color.html)

```kotlin
var backgroundColor: Color?
```

The colour drawn behind all layers.
