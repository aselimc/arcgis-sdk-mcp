**ESM**

```js
import TideLayer from "@harbor/core/layers/TideLayer.js";
```

**CDN**

```js
const TideLayer = await $harbor.import("@harbor/core/layers/TideLayer.js");
```

# TideLayer

- **Inheritance:** TideLayer → [Layer](https://docs.example.com/harbor/latest/references/core/layers/Layer/)

- **Since:** Harbor Maps SDK 2.0

## Overview

A TideLayer draws one symbol per tide gauge and keeps it up to date.

> **Known limits**
>
> At most 500 gauges are drawn at once.

## Constructors

| Name | Type / signature | Flags | Summary |
| --- | --- | --- | --- |
| `Constructor` |     |     | Creates a layer from a gauge source. |

### Constructor

_Constructor_

Creates a layer from a gauge source.

## Properties

| Name | Type / signature | Flags | Summary |
| --- | --- | --- | --- |
| `id` | `string` | readonly, inherited | The unique id given to the layer when it is created. |
| `labelField` | `string \| null` |     | Name of the attribute shown next to each gauge. |

Any property can be set in the constructor.

### id

_Property_ `readonly` `inherited`

- **Type:** [string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)

Inherited from: [Layer](https://docs.example.com/harbor/latest/references/core/layers/Layer/)

The unique id given to the layer when it is created.

### labelField

_Property_

- **Type:** string | null

Name of the attribute shown next to each gauge. No labels are drawn when it is null.

## Methods

| Name | Type / signature | Flags | Summary |
| --- | --- | --- | --- |
| `queryGauges` | `queryGauges (filter?: GaugeFilter): Promise<Gauge[]>` |     | Returns the gauges that match a filter. |

### queryGauges

_Method_

```ts
queryGauges (filter?: GaugeFilter): Promise<Gauge[]>
```

Returns the gauges that match a filter. All gauges are returned without one.

**Parameters**

| Parameter | Type | Description | Required |
| --- | --- | --- | --- |
| filter | [GaugeFilter](https://docs.example.com/harbor/latest/references/core/GaugeFilter/) \| undefined | Limits the result by region or by station type. | no  |

- **Returns:** Promise<Gauge\[\]>
- **Example:**

  ```js
  const gauges = await layer.queryGauges();
  console.log(gauges.length);
  ```

## Events

| Name | Type / signature | Flags | Summary |
| --- | --- | --- | --- |
| `event-refresh` |     |     | Fires after new readings have been drawn. |

### refresh

_Event_

Fires after new readings have been drawn.

## Type definitions

| Name | Type / signature | Flags | Summary |
| --- | --- | --- | --- |
| `RefreshEvent` |     |     | Describes one refresh of the layer. |

### RefreshEvent

_Type definition_

Describes one refresh of the layer.

#### count

_Property_

- **Type:** number

How many gauges changed.
