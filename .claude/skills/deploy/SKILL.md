---
name: deploy
description: Deploy application to AWS S3
disable-model-invocation: true
---

# Action

1. Perform a production build of the application code:
   ```bash
   npm run build
   ```
2. Deploy the application code to the AWS S3 bucket for the SPA:
   ```bash
   aws s3 sync dist/ s3://retirementplanner-web-242065761054-us-east-1 --delete --profile petroapps
   ```
3. Set `Cache-Control: no-cache` on the service worker, manifest, HTML, favicon, and icons so
   browsers and installed PWAs (Android WebAPK) always revalidate them instead of using stale
   cached copies. Hashed files under `assets/` keep the default caching:
   ```bash
   aws s3 cp dist/ s3://retirementplanner-web-242065761054-us-east-1/ --recursive --exclude "*" --include "sw.js" --include "expenser-manifest.json" --include "*.html" --include "favicon.ico" --include "icons/*" --cache-control "no-cache" --metadata-directive REPLACE --profile petroapps
   ```
4. Invalidate CloudFront distribution cache:
   ```bash
   aws cloudfront create-invalidation --distribution-id E1I86LT48MQ21M --paths "/*" --profile petroapps
   ```
