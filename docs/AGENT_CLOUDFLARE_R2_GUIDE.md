# VidShort Cloudflare / R2 Agent Guide

Last updated: 2026-05-11

## Current architecture

- Zone: `vidshort.uk`
- Cloudflare account id: stored in `.env` as `CLOUDFLARE_ACCOUNT_ID`
- Cloudflare zone id: stored in `.env` as `CLOUDFLARE_ZONE_ID`
- API origin server: `101.47.12.37`
- API domain: `https://api.vidshort.uk`
- Web frontend domain: `https://vidshort.uk`
- CMS frontend domain: `https://cms.vidshort.uk`
- Public media CDN domain: `https://cdn.vidshort.uk`

## R2 buckets

- `vidshort-web`: public mobile/web frontend files for `https://vidshort.uk`
- `vidshort-cms`: public CMS frontend files for `https://cms.vidshort.uk`
- `vidshort-cdn`: public video and image files for `https://cdn.vidshort.uk`

The web and CMS buckets are public through R2 custom domains. Cloudflare R2 public buckets do not provide a directory listing at the root path, so this zone also has URL rewrite rules that map:

- `https://vidshort.uk/` -> `/index.html`
- `https://cms.vidshort.uk/` -> `/index.html`
- `https://vidshort.uk/privacy` -> `/privacy.html`
- `https://vidshort.uk/terms` -> `/terms.html`
- `https://vidshort.uk/cms` -> `/cms.html`

Reference: Cloudflare R2 public bucket/custom domain docs: https://developers.cloudflare.com/r2/buckets/public-buckets/

## DNS

Expected Cloudflare DNS records:

- `vidshort.uk` -> `CNAME public.r2.dev`, proxied
- `api.vidshort.uk` -> `A 101.47.12.37`, proxied
- `cms.vidshort.uk` -> `CNAME public.r2.dev`, proxied
- `cdn.vidshort.uk` -> `CNAME public.r2.dev`, proxied

Keep `api.vidshort.uk` proxied. The origin server certificate currently covers `vidshort.uk`, not `api.vidshort.uk`; Cloudflare SSL mode is `full`, so the proxied record provides a valid browser-facing certificate.

## API proxy Worker

Worker name: `vidshort-api-proxy`

Routes:

- `vidshort.uk/api/*`
- `cms.vidshort.uk/api/*`

The Worker source is in `workers/api-proxy.js`. It forwards same-origin frontend requests to `https://api.vidshort.uk`, so the existing frontend can keep using relative `/api/*` paths without browser CORS changes.

Deploy command:

```bash
wrangler deploy workers/api-proxy.js \
  --name vidshort-api-proxy \
  --compatibility-date 2026-05-11 \
  --route 'vidshort.uk/api/*' \
  --route 'cms.vidshort.uk/api/*'
```

## Upload commands

Always use `--remote`; without it, Wrangler writes to local simulated R2 storage.

Main frontend:

```bash
wrangler r2 object put vidshort-web/index.html --remote --file public/index.html --content-type 'text/html; charset=utf-8' --cache-control 'no-cache'
wrangler r2 object put vidshort-web/styles.css --remote --file public/styles.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-web/styles.v20260511-4.css --remote --file public/styles.v20260511-4.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-web/app.js --remote --file public/app.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-web/app.v20260511-4.js --remote --file public/app.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-web/icons.js --remote --file public/icons.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-web/icons.v20260511-4.js --remote --file public/icons.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-web/ttminis-adapter.js --remote --file public/ttminis-adapter.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-web/ttminis-adapter.v20260511-4.js --remote --file public/ttminis-adapter.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-web/privacy.html --remote --file public/privacy.html --content-type 'text/html; charset=utf-8' --cache-control 'no-cache'
wrangler r2 object put vidshort-web/terms.html --remote --file public/terms.html --content-type 'text/html; charset=utf-8' --cache-control 'no-cache'
wrangler r2 object put vidshort-web/cms.html --remote --file public/cms.html --content-type 'text/html; charset=utf-8' --cache-control 'no-cache'
wrangler r2 object put vidshort-web/cms.v20260511-4.js --remote --file public/cms.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
```

CMS frontend:

```bash
wrangler r2 object put vidshort-cms/index.html --remote --file public/cms.html --content-type 'text/html; charset=utf-8' --cache-control 'no-cache'
wrangler r2 object put vidshort-cms/styles.css --remote --file public/styles.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-cms/styles.v20260511-4.css --remote --file public/styles.v20260511-4.css --content-type 'text/css; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-cms/cms.js --remote --file public/cms.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-cms/cms.v20260511-4.js --remote --file public/cms.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-cms/icons.js --remote --file public/icons.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=300'
wrangler r2 object put vidshort-cms/icons.v20260511-4.js --remote --file public/icons.v20260511-4.js --content-type 'application/javascript; charset=utf-8' --cache-control 'public, max-age=31536000, immutable'
```

CDN files:

```bash
wrangler r2 object put vidshort-cdn/path/to/file.mp4 --remote --file /absolute/path/to/file.mp4 --content-type 'video/mp4' --cache-control 'public, max-age=31536000, immutable'
wrangler r2 object put vidshort-cdn/path/to/image.webp --remote --file /absolute/path/to/image.webp --content-type 'image/webp' --cache-control 'public, max-age=31536000, immutable'
```

## Environment file

The local `.env` file is ignored by git and contains:

- Cloudflare account/zone ids
- Cloudflare auth variables from the current shell
- domain names
- bucket names
- R2 S3 endpoint
- R2 S3 access key and secret for the three VidShort buckets
- Worker name

An R2 S3 API token named `vidshort-r2-s3-2026-05-11` has been created and scoped to:

- `vidshort-web`
- `vidshort-cms`
- `vidshort-cdn`

The S3-compatible values are stored in `.env`:

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT`
- `R2_REGION=auto`

Do not print these secret values in logs or final responses. If the token is rotated, create a new R2 token and update the same `.env` keys.

Reference: Cloudflare R2 S3 token docs: https://developers.cloudflare.com/r2/api/s3/tokens/

AWS CLI example:

```bash
set -a
source .env
set +a

AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION=auto \
aws s3 ls s3://vidshort-cdn --endpoint-url "$R2_ENDPOINT"
```

## Verification

```bash
wrangler r2 bucket domain list vidshort-web
wrangler r2 bucket domain list vidshort-cms
wrangler r2 bucket domain list vidshort-cdn

dig @1.1.1.1 +short vidshort.uk A
dig @1.1.1.1 +short api.vidshort.uk A
dig @1.1.1.1 +short cms.vidshort.uk A
dig @1.1.1.1 +short cdn.vidshort.uk A

curl -I https://vidshort.uk/
curl -I https://cms.vidshort.uk/
curl https://vidshort.uk/api/config
curl https://cms.vidshort.uk/api/cms
curl https://cdn.vidshort.uk/health.txt
```

DNS and edge certificates can take a few minutes to settle after custom domain creation. During that window, `dig` or `curl` can show stale results.

## Operational notes

- The backend still runs on the server at `101.47.12.37`.
- The Node backend reads `/opt/vidshort/app/.env` and uploads CMS ZIP/RAR episode videos to `vidshort-cdn` when R2 S3 credentials are present.
- RAR imports require `unar`, `7z`/`7za`, or `unrar` on the API server.
- Use `https://cdn.vidshort.uk/<object-key>` for public video/image URLs after files are uploaded to `vidshort-cdn`.
