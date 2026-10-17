# Public product and OAuth boundary

The Analytics product URL and the OAuth callback are separate public surfaces.

```text
Business Product URL: https://<analytics-public-domain>/
OAuth start:          https://<oauth-domain>/oauth/shopee/start
OAuth callback:       https://<oauth-domain>/oauth/shopee/callback
```

## Business Product URL

Publish the existing Shopee Analytics UI only behind company access control. The review/development deployment must use an independent, empty analytics database and `OFFLINE_BASELINE`: no Partner credentials, no token, no worker sync, and no synthetic business data. The UI is allowed to show only its real empty or connection state.

## OAuth surface

`oauth-server.js` exposes only `/health`, `/oauth/shopee/start`, and `/oauth/shopee/callback`. It does not mount the Analytics API, Web UI, sync commands, or any Ads write endpoint. It binds to loopback unless `SHOPEE_OAUTH_ALLOW_REMOTE=YES` is explicitly set.

OAuth is disabled by default. It can run only in `PILOT_GMV_MAX` with `SHOPEE_OAUTH_ENABLE=YES`, a valid HTTPS `SHOPEE_OAUTH_LIVE_REDIRECT_URL`, ADS credentials stored locally, and the canonical Pilot shop environment variable. `SHOPEE_OAUTH_TEST_REDIRECT_URL` is reserved for future sandbox support and is never substituted into the production Shopee endpoint.

The callback stores only a SHA-256 hash of its 32-byte random state. The raw state exists only in a Secure, HttpOnly, SameSite=Lax browser cookie. State is short-lived, one-time, and atomically consumed before a token exchange. Tokens are persisted only through the encrypted `shopee_app_tokens` store.

## This repository does not deploy public infrastructure

No domain purchase, DNS change, public tunnel, reverse proxy, or cloud service is created by this code. Before Go Live, provision a company-controlled HTTPS gateway, access control for the Analytics UI, and a private path to the desktop host. Do not expose PostgreSQL or the complete Analytics HTTP API to the public Internet.
