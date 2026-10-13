---
title: Choosing an ArcGIS authentication type
verifiedOn: 2026-10-13
sources:
  - https://developers.arcgis.com/documentation/security-and-authentication/
  - https://developers.arcgis.com/documentation/security-and-authentication/types-of-authentication/
  - https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/
  - https://developers.arcgis.com/documentation/security-and-authentication/user-authentication/
  - https://developers.arcgis.com/documentation/security-and-authentication/app-authentication/
  - https://developers.arcgis.com/documentation/security-and-authentication/security-best-practices/
---

# Choosing an ArcGIS authentication type

Every request to a secure ArcGIS resource carries an access token. ArcGIS has three ways to obtain one ([types of authentication](https://developers.arcgis.com/documentation/security-and-authentication/types-of-authentication/)). Pick by answering one question first: does the end user sign in with an ArcGIS account?

## Decision table

| Situation | Use | Why |
| --- | --- | --- |
| Public app, nobody signs in, only location services and public or your own items | API key authentication | simplest; the key is embedded in the app |
| Users sign in and work with their own or their organization's content | User authentication (OAuth 2.0) | acts on the user's behalf with the user's privileges |
| A web server or script acts for the app, no user sign-in | App authentication (OAuth 2.0 client credentials) | short-lived tokens; the secret stays on the server |

## API key authentication

- A long-lived access token created from API key credentials, valid for up to one year, limited to the privileges and items selected on the credential ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/)).
- Esri recommends it only for public information and basic location services. It does not protect confidential data: for private items or sensitive hosted data use one of the other two types.
- Usage is billed to the developer account that owns the key.

## User authentication

- Users sign in with an ArcGIS account; the app receives a token through an OAuth 2.0 flow, normally authorization code ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/user-authentication/)). Older material calls this named user login or ArcGIS identity.
- What the app can do depends on the user's type, role and privileges, and service usage is billed to the user's account.
- Needs OAuth credentials (client id and redirect URLs) registered in the portal.

## App authentication

- Exchanges a client id and client secret for a short-lived token tied to the developer's account ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/app-authentication/)).
- Belongs on a web server or in a console script. Never ship the client secret in a browser or mobile app, and do not use it where users must sign in.

## Checks before writing code

- Which portal issues the token: ArcGIS Location Platform, ArcGIS Online or ArcGIS Enterprise. Credentials are created in that portal and privileges differ between them.
- Scope a credential to the privileges the app needs and restrict referrers where the portal allows it ([security best practices](https://developers.arcgis.com/documentation/security-and-authentication/security-best-practices/)).
- Some features dictate the type: the JavaScript AI components require user authentication (`brief:ai/js-ai-components-constraints`).

For the SDK-specific code, search the product's own guide, for example `arcgis_docs_search` with `query: "user authentication"` and the product id; the pages above explain the concepts only.
