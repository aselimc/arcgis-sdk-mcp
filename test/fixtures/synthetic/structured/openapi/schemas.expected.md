# Types

## KindId

Type: `string`

Identifies a kind of beacon.

Constraints: one of `tower`, `buoy`.

```json
"tower"
```

## NearPointResult

Type: `object`

One beacon found by a `beacons/near-point` request.

It carries the beacon and how far away it is.

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `beaconId` | `string` | yes | Identifier of the beacon. Constraints: min length 1. |
| `kinds` | [KindId](https://developers.arcgis.com/rest/beacons/types/#kindid)[] | yes | Every kind the beacon belongs to. |
| `distance` | `number` | no | Distance from the search centre, in metres. Constraints: min 0. |

```json
{
  "beaconId": "b-17",
  "distance": 42.5
}
```
