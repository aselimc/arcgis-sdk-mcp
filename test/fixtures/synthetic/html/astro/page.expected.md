# Plot tide stations

Learn how to draw a tide station layer on a chart and label each gauge.

This walkthrough takes about ten minutes.

> **Note:**
>
> You need a free harbor key before you start.

> **More info:**
>
> Gauges report every six minutes, so the layer refreshes itself.

## Prerequisites

Finish the first chart walkthrough, or start from the starter pen.

## Steps

### Add the station layer

1. Create a [`TideLayer`](https://docs.example.com/harbor/latest/references/TideLayer/) and add it to the chart.

   ```js
   const chart = new Chart("view");

   const stations = new TideLayer({ source: "gauges" });
   chart.add(stations);
   ```
2. Reload the page. Each gauge appears as a blue dot.

### Label the gauges

Set `labelField` to the station name. Back to top

## What's next

Try the [animation walkthrough](https://docs.example.com/harbor/latest/tutorials/animate-tides/).
