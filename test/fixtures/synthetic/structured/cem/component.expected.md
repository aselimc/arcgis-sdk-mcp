_Web component_ · class `HarbourGauge` · package `@example/harbour-components`

```js
import "@example/harbour-components/components/harbour-gauge";
```

# harbour-gauge

_since 1.4_

Shows the water level of a harbour as a dial.

## Placing the gauge

Put it inside any container:

```html
<harbour-gauge harbour="brest"></harbour-gauge>
```

**See also**

- [Docs](https://example.com/components/harbour-gauge/)

## Properties

### harbour

```ts
harbour: string | undefined
```

_attribute `harbour` · reflects_

Identifier of the harbour to show. Changing it reloads the readings.

### scale

```ts
scale: "s" | "m" | "l" = "m"
```

_attribute `scale`_

Size of the dial.

**See also**

- [Sizing guide](https://example.com/sizing/)

### reading

```ts
reading: Reading | undefined
```

_readonly_

The latest reading.

### legacyMode

```ts
legacyMode: boolean = false
```

_attribute `legacy-mode`_

> **Deprecated:** Will be removed in 2.0.

Draws the dial the old way.

## Methods

### refresh

```ts
refresh(): Promise<Reading>
```

Loads a new reading now.

**Returns:** The new reading.

**Example**

```js
const gauge = document.querySelector("harbour-gauge");
await gauge.refresh();
```

### setRange

```ts
setRange(low: number, high?: number): void
```

Sets the lowest and highest level the dial can show.

**Parameters**

- `low` (`number`): Lowest level.
- `high` (`number`, optional): Highest level.

### componentOnReady

```ts
componentOnReady(): Promise<this>
```

Resolves once the component has rendered.

## Events

### harbourReadingChange

```ts
harbourReadingChange: CustomEvent<{ level: number; }>
```

_since 1.5_

Fires when a new reading arrives.

### harbourReady

```ts
harbourReady: CustomEvent
```

Fires once after the first render.

## Slots

- _default slot_: Content shown under the dial.
- `label`: Replaces the built-in label.

## CSS custom properties

- `--harbour-gauge-needle-color`: Colour of the needle.
