_Class_ · `@example/core/Buoy`

```js
import Buoy from "@example/core/Buoy.js";
```

# Buoy

_since 2.0_

A buoy marks a channel.

## Properties

### colour

```ts
accessor colour: string;
```

Colour of the buoy.

### lit

```ts
get lit(): boolean;
```

_readonly_

Whether the lamp is lit.

## Methods

### ring

```ts
ring(times: number): void;
```

Sounds the bell.

**Parameters**

- `times`: How often to ring.

## Unparsed declarations

### mooring

```ts
mooring(options: { depth: number; ): Promise<void>;
```

_unparsed declaration_

Where the buoy is moored. The declaration below lost its closing bracket.
