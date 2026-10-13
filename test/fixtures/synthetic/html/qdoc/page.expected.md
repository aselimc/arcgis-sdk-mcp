# Chart Class

```cpp
class Harbor::Chart
```

A chart holds the layers that a view draws. [More...](https://docs.example.com/harbor-qt/cpp/api-reference/harbor-chart.html#details)

- **Header:** `#include <Chart.h>`
- **Since:** Harbor 2.0

## Public Functions

- [`Chart(QObject *parent = nullptr)`](https://docs.example.com/harbor-qt/cpp/api-reference/harbor-chart.html#Chart)
- [`double maxScale() const`](https://docs.example.com/harbor-qt/cpp/api-reference/harbor-chart.html#maxScale)

## Detailed Description

Add layers to a chart, then hand the chart to a view.

> **Note:** A chart can be shown in one view at a time.

```cpp
auto* chart = new Chart(this);
view->setChart(chart);
```

## Member Function Documentation

### Chart

```cpp
[explicit] Chart::Chart(QObject *parent = nullptr)
```

Creates an empty chart.

- _parent_ - The optional parent object.

### maxScale

```cpp
double Chart::maxScale() const
```

Returns the largest scale the chart can be shown at. Zero means there is no limit.
