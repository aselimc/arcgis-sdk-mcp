- **URL:** `https://<root>/<portName>/BerthServer/find`
- **Methods:** `GET`, `POST`
- **Version Introduced:** 3.1

# Find berths

## Description

The find operation returns the berths of a port that are free in a time window.

## Request parameters

_Parameter / Details_

**`window` (Required)**

Start and end of the stay as two timestamps.

```http
window=1767225600,1767312000
```

**`minLength`**

Shortest berth to return, in metres.

- Default: `0`

### Sort order

| Value | Meaning | Default |
| --- | --- | --- |
| length | Longest berth first.<br>Ties keep their catalogue order. | yes |
| name | Alphabetical. |     |

## Example usage

**Any berth**

Every free berth in the first week of the year:

```http
GET /north/BerthServer/find?window=1767225600,1767830400&f=json
```

**Long berths**

Only berths of 200 metres or more:

```http
GET /north/BerthServer/find?window=1767225600,1767830400&minLength=200&f=json
```

## JSON Response example

**`berths`**

- **Type:** array
- **Notes:**
  - Empty when nothing is free.
  - At most 50 entries.

```json
{
  "berths": [{ "name": "N4", "length": 240 }]
}
```
