```http
GET https://beacons-api.example.com/v1/beacons/near-point
```

**Operation ID:** `beaconsNearPointGet`

# GET /beacons/near-point

Find beacons close to a coordinate.

The `/beacons/near-point` request lists the beacons inside a circle
around a coordinate.

You must send the `x` and `y` values. You may also send:

- A search radius
- One or more kind ids

**Note**: results are ordered by distance.

## Query parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `x` | [XCoord](https://developers.arcgis.com/rest/beacons/types/#xcoord) (number) | yes | Longitude of the search centre, in decimal degrees. Constraints: min -180; max 180. Example: `-4.5`. |
| `kindIds` | [KindId](https://developers.arcgis.com/rest/beacons/types/#kindid)[] | no | Keeps only beacons of these kinds.<br>A beacon matches when it has _any_ of the ids. Useful values:<br>- `tower` for masonry towers<br>- `buoy` for floating marks Example: `tower,buoy`. |
| `pageSize` | `integer` | no | How many beacons one response holds. Default `10`. Constraints: min 1; max 20. Example: `10`. |
| `f` | `string` | no | Response format, `json` or `pjson` (a \| b). Default `json`. Constraints: one of `json`, `pjson`. |
| `tags` | `string[]` | no | Free-text tags. |

## Header parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `X-Request-Id` | `string` | no | Echoed back in the response. |

## Examples

```bash
curl 'https://beacons-api.example.com/v1/beacons/near-point?x=-4.5&y=48.4' \
  -H 'Authorization: Bearer <TOKEN>'
```

```javascript
const response = await fetch(url, { headers });
console.log(await response.json());
```

## Responses

### 200 OK

The beacons that were found.

`application/json`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `results` | [NearPointResult](https://developers.arcgis.com/rest/beacons/types/#nearpointresult)[] | yes |  |
| `paging` | `object` | no | Links to further pages. |
| `paging.nextUrl` | `string` | no | Address of the next page. Constraints: min length 1. |

```json
{
  "results": [
    { "beaconId": "b-17", "distance": 42.5 }
  ]
}
```

### 400 Bad Request

A parameter is missing or out of range.

`application/json` · [Error](https://developers.arcgis.com/rest/beacons/types/#error)

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `error` | `object` | yes | What went wrong. Constraints: one of `400`, `401`. |
| `error.code` | `integer` | yes | Numeric error code. Constraints: one of `400`, `401`. |
