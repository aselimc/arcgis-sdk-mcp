_Type_ · namespace `ArcGIS.Desktop.GeoProcessing` · assembly `ArcGIS.Desktop.GeoProcessing`

# GeoprocessingProjectItem

```csharp
ArcGIS.Desktop.GeoProcessing.GeoprocessingProjectItem
```

Represents a GeoProcessing project item.

## Constructors

### GeoprocessingProjectItem

```csharp
GeoprocessingProjectItem(ItemInfoValue)
```

Represents a GeoProcessing project item.

## Properties

### IsSearchable

```csharp
GeoprocessingProjectItem.IsSearchable
```

Gets whether the item is searchable. Default is true.

### GPItemInfo

```csharp
GeoprocessingProjectItem.GPItemInfo
```

Gets the underlying GP Item info

### DisplayType

```csharp
GeoprocessingProjectItem.DisplayType
```

Gets the display type of the geoprocessing item. This is a localized string.

### RequiresMainThread

```csharp
GeoprocessingProjectItem.RequiresMainThread
```

Gets whether the Item must be refreshed on the MCT within the lambda of a QueuedTask.Run. Always returns false.

### Text

```csharp
GeoprocessingProjectItem.Text
```

Gets the item text

### HelpID

```csharp
GeoprocessingProjectItem.HelpID
```

Gets the associated help id or null if there is no help id

## Methods

### HasLimit

```csharp
GeoprocessingProjectItem.HasLimit(string name)
```

Determines if the item has a specific limit.

**Parameters**

- `name` (`string`)

**Returns:** `Boolean`

### GetRepairPath

```csharp
GeoprocessingProjectItem.GetRepairPath()
```

Gets the repair path

### Search

```csharp
GeoprocessingProjectItem.Search(string searchString)
```

Searches the item for the specified string.

**Parameters**

- `searchString` (`string`): the search string.
