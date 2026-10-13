# Tide alert profile

Profile id: `tide-alert`

**Function bundles:** `core`, `geometry`

## Profile variables

| Variable | Type | Description |
| --- | --- | --- |
| `$gauge` | `feature` | The gauge whose reading triggered the alert. |
| `$context` | `dictionary` | - `level` (number): The reading, in metres.<br>- `rising` (boolean): Whether the tide is coming in. |
