# Cloudflare Tunnel Production Runtime

This is the current production runtime path while Railway is unavailable. The deployed user path is a local production-mode Fastify server exposed through a Cloudflare Tunnel public hostname.

Source release and runtime refresh are separate gates:

1. GSD milestone branch is verified and closed out.
2. A PR merges the source release into `main`.
3. The user explicitly approves production runtime refresh.
4. The local production-mode server is built, migrated, restarted, and exposed through Cloudflare Tunnel.
5. Public-domain smoke passes against the tunnel hostname.

Do not treat GSD closeout, PR creation, CI success, localhost checks, or frontend build success as proof that production runtime has been refreshed.

## Environment

Set these values for the local production-mode server. Use stable local paths for SQLite and durable assets; do not point production runtime at throwaway test directories.

```bash
NODE_ENV=production
PORT=3000
DB_PATH=./data/nutrition.db
ASSETS_DIR=./data/assets
UPLOADS_STAGING_DIR=./data/uploads-staging
CLIENT_DIST_DIR=./dist/client
TZ=Asia/Taipei
GUEST_SESSION_SECRET=<stable random value from `openssl rand -hex 32`>
OPENAI_API_KEY=<provider key>
OPENAI_ORCHESTRATOR_MODEL=<model>
```

`GUEST_SESSION_SECRET` is app-owned signing material for browser guest-session cookies. Production-like runtime rejects a missing, default, or shorter-than-32-character value, so set it before starting the server and do not reuse the development default.

## Build and Start

Run from a source checkout that is intentionally selected for production runtime refresh, normally `main` after the source release PR has merged.

```bash
yarn install --frozen-lockfile
yarn release:check
yarn build
yarn db:migrate
yarn start
```

`yarn start` serves the API and `dist/client` from one same-origin Fastify process when `CLIENT_DIST_DIR` contains the built frontend shell.

## Cloudflare Tunnel

Use a stable Cloudflare Tunnel route that maps the public hostname to the local Fastify service URL, for example `http://localhost:3000`.

For a locally managed tunnel, the normal setup is:

```bash
cloudflared tunnel login
cloudflared tunnel create <name>
cloudflared tunnel route dns <name> <public-hostname>
cloudflared tunnel run <name>
```

For a dashboard-managed tunnel, configure a published application route in Cloudflare that maps the chosen hostname to the local service URL.

Do not use the Vite dev server as the tunnel origin for production smoke. The required public smoke must use the stable named tunnel: a temporary Quick Tunnel (including a `trycloudflare.com` URL) cannot preserve this app's required same-origin SSE proof and is not acceptable evidence for the checklist below.

References:

- [Create a locally-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)
- [Set up Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/setup/)
- [Tunnel configuration file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/)

## Manual Smoke Checklist

Run this checklist from the Cloudflare Tunnel public hostname before marking production runtime refreshed. Public-domain smoke stays runtime-gated, so do not treat localhost-only build smoke as equivalent.

1. Open the public tunnel hostname and send a same-origin text chat request. Confirm the page, API calls, and SSE stream all stay on the same public origin.
2. Send one image-backed request. Confirm the image is accepted and the response/history references the stored asset.
3. Refresh the page. Confirm the conversation and meal state persist after reload.
4. Call `GET /api/assets/:id` for the uploaded image using the same browser session cookies. Confirm the request succeeds with the expected image response.
5. Re-open chat and the summary surface on a phone-sized viewport. Confirm the same-origin shell still works and the persisted image remains visible in both chat history and the meal list on the public tunnel domain.

## Stop Conditions

Stop the refresh or smoke and report the blocker if any of these happen:

- `yarn release:check`, `yarn build`, or `yarn db:migrate` fails.
- Boot logs show `[nutrition-coach] Invalid TZ configuration:`.
- Runtime rejects `GUEST_SESSION_SECRET`.
- The tunnel hostname routes to the wrong port, Vite dev server, localhost-only URL, or stale process.
- Same-origin API/SSE, reload persistence, or protected asset fetch fails on the public tunnel domain.

## Deployment Notes

- Keep SQLite, durable assets, and uploads staging on stable local storage.
- Keep the frontend build output in `dist/client` so Fastify serves the same-origin app shell.
- Treat production runtime refresh as a manual operation after source release, not as a side effect of GSD closeout, PR creation, or tag creation.
- Do not expose secrets, cookies, raw user data, or local debug artifacts in smoke evidence.
