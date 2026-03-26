# Landing Page Download Button

## Problem

The download button component (`landing/src/components/download-button.tsx`) exists but is invisible because the R2 version fetch fails due to CORS. The R2 bucket (`pub-3bbf8a6a4ba248d3aaa0453e7c25d57e.r2.dev`) doesn't return `Access-Control-Allow-Origin` headers, so browsers block the request from `localhost:5173` (and any deployed origin). The component catches the error and returns `null`.

## Solution

Two-part fix:

### 1. Configure CORS on the R2 bucket

Add a CORS policy to the `anvil-builds` R2 bucket via Cloudflare dashboard or `wrangler`:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

This is a public bucket serving read-only assets, so `*` origin is appropriate.

**How to apply via wrangler CLI:**

```bash
# Create a cors-rules.json file with the above content, then:
npx wrangler r2 bucket update anvil-builds --cors-policy cors-rules.json
```

Or configure via the Cloudflare dashboard: R2 &gt; anvil-builds &gt; Settings &gt; CORS Policy.

### 2. Improve the download button error UX

Currently on fetch failure the button disappears entirely. Instead, show a static fallback that links to the GitHub releases page or shows a manual install command, so users always see a download path.

## Phases

- [x] Configure CORS on the R2 `anvil-builds` bucket (manual step via Cloudflare dashboard or wrangler CLI)

- [x] Update `download-button.tsx` to show a fallback on error instead of hiding

- [x] Verify the button renders correctly on `localhost:5173`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---