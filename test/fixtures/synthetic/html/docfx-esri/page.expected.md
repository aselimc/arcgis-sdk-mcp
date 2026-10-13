```python
harbor.channel.Dredge(in_channel, target_depth, {method})
```

# Dredge (Channel Tools)

## Summary

Lowers the bed of a channel polygon to a target depth and reports the removed volume.

## Usage

- The channel must be a single polygon.

> **Note:**
>
> Depths are positive downwards. See [**Datum**](https://desk.example.com/en/latest/tool-reference/environments/datum.html).

## Parameters

**`in_channel`** — _Feature Layer_, required

The channel polygon to dredge.

**`target_depth`** — _Double_, required

The depth of the bed after dredging, in metres.

**`method`** — _String_, optional

Specifies how the bed is lowered.

- FLAT—The whole bed is set to the target depth. This is the default.
- SLOPED—The banks keep a slope of one in three.

### Code sample

**Dredge example (Python window)**

Lower the north channel to twelve metres.

```python
# the channel layer is in the current map
import harbor
harbor.channel.Dredge("north_channel", 12.0, "SLOPED")
```

## Licensing information

- Basic: No
- Standard: Yes
