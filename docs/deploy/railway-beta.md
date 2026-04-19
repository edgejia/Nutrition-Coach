# Railway Beta Baseline

This repo targets one persistent web service with one public domain and one mounted volume.

## Baseline

- Service type: persistent web service
- Public domain: Railway-generated domain or a custom domain attached to the same service
- Mounted volume: one volume at `/app/data`
- Runtime note: volumes are available at runtime, not build time

## Environment

Set these exact values on the service:

```bash
DB_PATH=/app/data/nutrition.db
ASSETS_DIR=/app/data/assets
UPLOADS_STAGING_DIR=/tmp/nutrition-uploads
CLIENT_DIST_DIR=/app/dist/client
TZ=Asia/Taipei
```

## Build and Start

Build command:

```bash
yarn install && yarn build
```

Start command:

```bash
yarn db:migrate && yarn start
```

That keeps schema mutation explicit and runs the app only after migrations have been applied to the mounted SQLite database.

## Preflight Audit

### Legacy raw upload paths

Before beta sign-off, run deterministic SQL checks against the live database and block rollout until both counts are zero or an intentional backfill/cleanup is recorded.

```sql
SELECT COUNT(*) AS raw_meal_image_paths
FROM meals
WHERE image_path LIKE '%/uploads/%'
   OR image_path LIKE 'server/uploads%';

SELECT COUNT(*) AS raw_chat_image_paths
FROM chat_messages
WHERE image_path LIKE '%/uploads/%'
   OR image_path LIKE 'server/uploads%';
```

If either count is non-zero, stop the rollout and record the cleanup or backfill that removed the legacy rows.

## Manual Smoke Checklist

Run this checklist from the public domain before marking the beta ready:

1. Open the public domain and send a same-origin text chat request. Confirm the page, SSE stream, and API calls all stay on the same domain.
2. Send one image-backed request. Confirm the image is accepted and the response/history references the stored asset.
3. Refresh the page. Confirm the conversation and meal state persist after reload.
4. Call `GET /api/assets/:id` for the uploaded image using the same `X-Device-Id`. Confirm the request succeeds with the expected image response.

## Deployment Notes

- Keep the SQLite file, durable assets, and any future uploads on the mounted volume.
- Do not rely on the build step to see volume contents.
- Keep the frontend build output in `dist/client` so Fastify can serve the same-origin app shell in beta.
