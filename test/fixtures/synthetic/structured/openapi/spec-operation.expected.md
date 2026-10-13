```http
GET https://beacons-api.example.com/v1/beacons/{beaconId}
```

**Operation ID:** `getBeacon`

# GET /beacons/{beaconId}

Read one beacon.

Returns the beacon with the given id.

## Path parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `beaconId` | `string` | yes | Identifier of the beacon. Constraints: pattern `^b-\d+$`. |

## Query parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `fields` | `string[]` | no | Properties to return. |

## Responses

### 200

The beacon.

`application/json` · `Beacon`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `beaconId` | `string` | yes | Identifier. |
| `height` | `number` | no | Height above ground, in metres. Default `10`. Constraints: min 0. |
| `position` | `Position` | no |  |
| `light` | `object` | no | The light the beacon shows. |
| `light.colour` | `string` | no | Constraints: one of `white`, `red`, `green`. |
| `light.period` | `number` | no | Seconds per cycle. |
| `keepers` | `Keeper[]` | no | People responsible for the beacon. |

```json
{
  "beaconId": "b-17",
  "height": 12
}
```

### 404

No beacon has this id.

`application/json` · `Problem`

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `message` | `string` | no |  |
