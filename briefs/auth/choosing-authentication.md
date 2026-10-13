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

Every request to a secure ArcGIS resource carries an access token, and there are three ways to get one ([types of authentication](https://developers.arcgis.com/documentation/security-and-authentication/types-of-authentication/)). First question: does the end user sign in with an ArcGIS account?

| Situation                                                                           | Use                                                 |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Public app without sign-in that uses location services and public or your own items | API key authentication                              |
| Users sign in and work with their own or their organization's content               | User authentication (OAuth 2.0)                     |
| A web server or script acts for the app, without user sign-in                       | App authentication (OAuth 2.0 client id and secret) |

## API key authentication

- A long-lived token created from API key credentials, valid for up to one year and limited to the privileges and items selected on the credential ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/api-key-authentication/)).
- Recommended by Esri only for public information and basic location services. It does not protect confidential data.
- Usage is billed to the subscription of the developer who created the key.
- Set allowed referrers and monitor usage ([best practices](https://developers.arcgis.com/documentation/security-and-authentication/security-best-practices/)).

## User authentication

- The user signs in and the app receives a token through an OAuth 2.0 flow, normally authorization code ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/user-authentication/)). Older material says "named user login" or "ArcGIS identity".
- The app can do what the user's type, role and privileges allow; usage is billed to the user's account.
- Requires OAuth credentials (client id, redirect URLs).

## App authentication

- A client id and client secret are exchanged for a short-lived token tied to the developer's account ([introduction](https://developers.arcgis.com/documentation/security-and-authentication/app-authentication/)).
- For web servers and console scripts. Do not put the secret in a browser or mobile app, and do not use this type where users must sign in.

## Before writing code

- Establish which portal issues the token: ArcGIS Location Platform, ArcGIS Online or ArcGIS Enterprise. The credentials are created there.
- Some features dictate the type: the JavaScript AI components need user authentication (`brief:ai/js-ai-components-constraints`).
- These pages explain concepts. For SDK code call `arcgis_docs_search` with a query such as "user authentication" and the product id.
