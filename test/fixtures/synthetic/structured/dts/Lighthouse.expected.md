_Class_ · `@example/core/Lighthouse`

```js
import Lighthouse from "@example/core/Lighthouse.js";
```

# Lighthouse

_since 1.0_

**Extends:** `EventedAccessor`, `LampMixin`. Inherited members are not listed here: look up the base class.

**Constructor options also come from:** `LampMixinProperties`

**Events also come from:** `LampMixinEvents`

A lighthouse stands on a headland and shows a [beam](https://example.com/references/core/Lighthouse/#beam).
Add keepers with `Lighthouse.addKeeper`.

**See also**

- [Sample - First light](https://example.com/sample-code/first-light/)
- [Beam](https://example.com/references/core/Beam/)

## Choosing a height

Taller towers are seen from further away.

```js
const tower = new Lighthouse({ height: 32 });
```

> [!WARNING]
>
> A tower without a lamp is only a tower.

## Constructors

### constructor

```ts
constructor(properties?: LighthouseProperties);
```

**Example**

```js
// Typical usage
const tower = new Lighthouse({
  name: "Eddystone"
});
```

## Properties

### type

```ts
get type(): "lighthouse";
```

_readonly_

The kind of structure, for checks that need no import.

### beam

```ts
get beam(): Beam | null | undefined;
set beam(value: BeamProperties | null | undefined);
```

_constructor option · since 1.2_

Constructor accepts: `BeamProperties | null`

The beam the lighthouse shows.

### height

```ts
accessor height: number;
```

_constructor option · default `20`_

Height of the tower above ground, in metres.

### keepers

```ts
get keepers(): Collection<Keeper>;
```

_readonly_

Everyone who has kept this lighthouse.

### name

```ts
accessor name: string | null | undefined;
```

_constructor option_

Display name.

### areas

```ts
readonly areas?: string[] | null;
```

_since 1.3_

Names of the sea areas the light covers.

### count

```ts
static count: number;
```

How many lighthouses exist.

## Methods

### addKeeper

```ts
addKeeper(keeper: Keeper, options?: SignalOptions): Keeper;
```

_since 1.1_

Adds a keeper to the list.

**Parameters**

- `keeper`: The keeper to add.
- `options`: How to announce the change.
- `options.silent`: Do not emit an event.

**Returns:** The keeper that was added.

**Examples**

```js
tower.addKeeper(keeper);
```

```ts
tower.addKeeper(keeper, { silent: true });
```

### measureRange

```ts
measureRange(weather?: "clear" | "fog"): Promise<{
    range: number;
    height: number | null;
}>;
```

Measures the range of the light.

**Parameters**

- `weather`: Sky condition at the time of measurement.

**Returns:** Range and the height it was measured at.

**Throws**

- When the lamp is off.

**See also**

- [Range tables](https://example.com/range/)

### extinguish

```ts
extinguish(): void;
```

> **Deprecated:** since 1.4. Use `Lighthouse.beam` instead.

Switches the lamp off.

## Constructor-only options

### profileId

```ts
profileId?: string;
```

Identifier of the stored lamp profile to start from. It is read once and is
not available afterwards.

## Events

### lamp-change

```ts
"lamp-change": { lit: boolean };
```

Fires when the lamp is switched on or off.
