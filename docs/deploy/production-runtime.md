# Cloudflare Tunnel Production Runtime

This is the current production runtime path while Railway is unavailable. The deployed user path is a local production-mode Fastify server exposed through a Cloudflare Tunnel public hostname.

The original v3.4.1 five-phase runtime/demo plan is terminated; its one-page
postmortem is [archived here](archive/v3.4.1-postmortem.md). The deployment
authority now has three gates:

Source release and runtime refresh are separate gates within this three-gate
model:

1. **Source release:** Work reaches PR-ready source state on a non-`main` branch. A PR targets `main`, and repository policy plus the required `Release Check` report source readiness. The maintainer separately decides whether to merge the PR into `main`. After merge, local post-merge planning archive/closeout runs from updated `main` when the GSD workflow is active. If that workflow is paused, stop instead of inventing or skipping the archive.
2. **Runtime safety and refresh:** The maintainer separately selects the merged source SHA and explicitly approves production runtime refresh. The approved B01 recovery gate quiesces writes, creates an off-checkout storage backup, and proves restore readiness before migration. Separately approved R05 migration and R06 build/start gates refresh the local production-mode server.
3. **Public validation:** Any Cloudflare Tunnel change and the public-domain smoke retain their own separate approvals.

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

Run source preflight at the selected merged-source SHA in a clean, non-serving verification checkout. `yarn release:check` includes the frontend build and rewrites `dist/client`; never run it in the checkout serving the active production runtime. These commands are an ordering reference, not a combined approval bundle.

```bash
cd /absolute/path/to/clean-non-serving-verification-checkout
yarn install --frozen-lockfile
cp .env.example .env
yarn release:check
```

After independently re-verifying the source SHA, merge, and completed post-merge archive, select the active runtime checkout separately. Before `yarn db:migrate` there, follow [Production Storage Recovery](storage-recovery.md): obtain B01 approval, quiesce writes, create and verify the bound backup, then obtain a separate R05 migration approval. Only a later R06 approval may build `dist/client` in that runtime checkout and start or restart the server.

```bash
yarn db:migrate
yarn build
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

Run this checklist from the Cloudflare Tunnel public hostname only after the separately approved R06 runtime refresh. Record public-domain smoke as its own outcome; it does not authorize, redefine, or stand in for the runtime refresh. Do not treat localhost-only build smoke as equivalent.

1. Open the public tunnel hostname and send a same-origin text chat request. Confirm the page, API calls, and SSE stream all stay on the same public origin.
2. Send one image-backed request. Confirm the image is accepted and the response/history references the stored asset.
3. Refresh the page. Confirm the conversation and meal state persist after reload.
4. Call `GET /api/assets/:id` for the uploaded image using the same browser session cookies. Confirm the request succeeds with the expected image response.
5. Re-open chat and the summary surface on a phone-sized viewport. Confirm the same-origin shell still works and the persisted image remains visible in both chat history and the meal list on the public tunnel domain.

## Stop Conditions

Stop the refresh or smoke and report the blocker if any of these happen:

- `yarn release:check`, `yarn build`, or `yarn db:migrate` fails.
- B01 backup verification, restore-readiness verification, or the post-migration storage assessment fails or becomes stale.
- Boot logs show `[nutrition-coach] Invalid TZ configuration:`.
- Runtime rejects `GUEST_SESSION_SECRET`.
- The tunnel hostname routes to the wrong port, Vite dev server, localhost-only URL, or stale process.
- Same-origin API/SSE, reload persistence, or protected asset fetch fails on the public tunnel domain.

## Deployment Notes

- Keep SQLite, durable assets, and uploads staging on stable local storage.
- Keep the frontend build output in `dist/client` so Fastify serves the same-origin app shell.
- Treat production runtime refresh as a manual operation after source release, not as a side effect of GSD closeout, PR creation, or tag creation.
- Keep PR-ready pre-merge work, human merge, post-merge local archive, runtime-refresh approval, B01 backup, R05 migration, R06 start, Tunnel mutation, and public smoke as distinct gates.
- Do not expose secrets, cookies, raw user data, or local debug artifacts in smoke evidence.
