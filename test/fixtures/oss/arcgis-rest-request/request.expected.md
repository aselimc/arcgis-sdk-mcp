_Module_ · `@esri/arcgis-rest-request/dist/esm/request`

```js
import { NODEJS_DEFAULT_REFERER_HEADER, setDefaultRequestOptions, getDefaultRequestOptions, ArcGISAuthError, checkForErrors, internalRequest, request } from "@esri/arcgis-rest-request";
```

# request

## Variables

### `NODEJS_DEFAULT_REFERER_HEADER`

```ts
const NODEJS_DEFAULT_REFERER_HEADER = "@esri/arcgis-rest-js";
```

## Functions

### setDefaultRequestOptions

```ts
function setDefaultRequestOptions(options: IRequestOptions, hideWarnings?: boolean): void;
```

> **Deprecated:** since v4.0.0.

Sets the default options that will be passed in **all requests across all `@esri/arcgis-rest-js` modules**.

```js
import { setDefaultRequestOptions } from "@esri/arcgis-rest-request";

setDefaultRequestOptions({
  authentication: ArcGISIdentityManager // all requests will use this session by default
})
```

You should **never** set a default `authentication` when you are in a server side environment where you may be handling requests for many different authenticated users.

**Parameters**

- `options`: The default options to pass with every request. Existing default will be overwritten.
- `hideWarnings`: Silence warnings about setting default `authentication` in shared environments.

### getDefaultRequestOptions

```ts
function getDefaultRequestOptions(): any;
```

### checkForErrors

```ts
function checkForErrors(response: any, url?: string, params?: IParams, options?: IRequestOptions, originalAuthError?: ArcGISAuthError): any;
```

Checks for errors in a JSON response from the ArcGIS REST API. If there are no errors, it will return the `data` passed in. If there is an error, it will throw an `ArcGISRequestError` or `ArcGISAuthError`.

**Parameters**

- `response`: The response JSON to check for errors.
- `url`: The url of the original request
- `params`: The parameters of the original request
- `options`: The options of the original request

**Returns:** The data that was passed in the `data` parameter

### request

```ts
function request(url: string, requestOptions?: IRequestOptions): Promise<any>;
```

Generic method for making HTTP requests to ArcGIS REST API endpoints.

```js
import { request } from '@esri/arcgis-rest-request';

request('https://www.arcgis.com/sharing/rest')
  .then(response) // response.currentVersion === 5.2

request('https://www.arcgis.com/sharing/rest', {
  httpMethod: "GET"
})

request('https://www.arcgis.com/sharing/rest/search', {
  params: { q: 'parks' }
})
  .then(response) // response.total => 78379
```

**Parameters**

- `url`: The URL of the ArcGIS REST API endpoint.
- `requestOptions`: Options for the request, including parameters relevant to the endpoint.

**Returns:** A Promise that will resolve with the data from the response.

## Classes

### ArcGISAuthError

```ts
class ArcGISAuthError extends ArcGISRequestError { ... }
```

This error is thrown when a request encounters an invalid token error. Requests that use `ArcGISIdentityManager` or
`ApplicationCredentialsManager` in the `authentication` option the authentication manager will automatically try to generate
a fresh token using either `ArcGISIdentityManager.refreshCredentials` or
`ApplicationCredentialsManager.refreshCredentials`. If the request with the new token fails you will receive an `ArcGISAuthError`
if refreshing the token fails you will receive an instance of `ArcGISTokenRequestError`.

```js
request(someUrl, {
  authentication: identityManager,
  // some additional options...
}).catch(e => {
  if(e.name === "ArcGISAuthError") {
    console.log("Request with a new token failed you might want to have the user authorize again.")
  }

  if(e.name === "ArcGISTokenRequestError") {
    console.log("There was an error refreshing the token you might want to have the user authorize again.")
  }
})
```

**Members**

- `constructor`: Create a new `ArcGISAuthError` object.
- `retry`
