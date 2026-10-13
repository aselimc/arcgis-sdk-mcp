_Class_ · `@esri/arcgis-rest-request/dist/esm/ApplicationCredentialsManager`

```js
import { ApplicationCredentialsManager } from "@esri/arcgis-rest-request";
```

# ApplicationCredentialsManager

**Extends:** `AuthenticationManagerBase`. Inherited members are not listed here: look up the base class.

**Implements:** `IAuthenticationManager`

Used to authenticate methods in ArcGIS REST JS with oAuth 2.0 application credentials. The instance of `ApplicationCredentialsManager` can be passed to `IRequestOptions.authentication` to authenticate requests.

```js
import { ApplicationCredentialsManager } from '@esri/arcgis-rest-request';

const session = ApplicationCredentialsManager.fromCredentials({
  clientId: "abc123",
  clientSecret: "••••••"
})
```

## Constructors

### constructor

```ts
constructor(options: IApplicationCredentialsManagerOptions);
```

## Properties

### portal

```ts
readonly portal: string;
```

### token

```ts
readonly token: string;
```

### clientId

```ts
readonly clientId: string;
```

### clientSecret

```ts
readonly clientSecret: string;
```

### expires

```ts
readonly expires: Date;
```

### duration

```ts
readonly duration: number;
```

## Methods

### fromCredentials

```ts
static fromCredentials(options: IApplicationCredentialsManagerOptions): ApplicationCredentialsManager;
```

Preferred method for creating an `ApplicationCredentialsManager`

### getToken

```ts
getToken(url: string, requestOptions?: ITokenRequestOptions): Promise<string>;
```

### refreshToken

```ts
refreshToken(requestOptions?: ITokenRequestOptions): Promise<string>;
```

### refreshCredentials

```ts
refreshCredentials(): Promise<this>;
```

### toJSON

```ts
toJSON(): {
    type: string;
    clientId: string;
    clientSecret: string;
    token: string;
    expires: Date;
    portal: string;
    duration: number;
};
```

Converts the `ApplicationCredentialsManager` instance to a JSON object. This is called when the instance is serialized to JSON with [`JSON.stringify()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify).

```js
import { ApplicationCredentialsManager } from '@esri/arcgis-rest-request';

const session = ApplicationCredentialsManager.fromCredentials({
  clientId: "abc123",
  clientSecret: "••••••"
})

const json = JSON.stringify(session);
```

**Returns:** A plain object representation of the instance.

### serialize

```ts
serialize(): string;
```

Serializes the `ApplicationCredentialsManager` instance to a JSON string.

**Returns:** The serialized JSON string.

### deserialize

```ts
static deserialize(serialized: string): ApplicationCredentialsManager;
```

Deserializes a JSON string previously created with `ApplicationCredentialsManager.serialize` to an `ApplicationCredentialsManager` instance.

**Parameters**

- `serialized`: The serialized JSON string.

**Returns:** An instance of `ApplicationCredentialsManager`.
