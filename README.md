# share-content-mcp

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/beynar/share-content-mcp)

`share-content-mcp` is a Cloudflare Worker that exposes a small MCP server for publishing immutable HTML or Markdown pages.

It stores shared content in a single SQLite-backed Durable Object, serves each page at a stable public URL, generates OG images, and lets MCP clients search previously shared pages by id, title, or label.

## What this MCP does

- Shares raw HTML as immutable public pages
- Renders Markdown to full HTML pages with React + Streamdown
- Stores all pages in one Durable Object backed by SQLite
- Serves public OG images for shared pages
- Exposes MCP tools for sharing content and searching pages

## MCP surface

### Tools

- `share_content`
  - Inputs: `html` or `markdown`, plus optional `title` and `label`
  - Output: shared page metadata including `id`, `url`, `format`, `title`, `label`, and `createdAt`
- `search_pages`
  - Inputs: `query`, optional `limit`
  - Output: matching page ids and metadata

### HTTP routes

- `GET|POST /mcp`
- `GET /p/:id`
- `GET /og/:id.png`
- `GET /healthz`

## Install

### 1. Deploy to Cloudflare

Use the button above, or deploy manually with Wrangler.

During setup, Cloudflare will provision the Durable Object automatically.

### 2. Set the API key

This MCP requires one secret:

- `MCP_API_KEY`

Set it to any token you want to use for authenticating MCP requests.

### 3. Get the Worker URL

Once the Worker is deployed, open the Cloudflare dashboard and copy the Worker URL from the Worker details page.

It will usually look like:

```text
https://your-worker-name.your-subdomain.workers.dev
```

If you later attach a custom domain, you can use that domain instead.

### 4. Connect your MCP client

To connect from an MCP client, use the Worker URL with the MCP path and the API key in the query string:

```text
https://your-worker-name.your-subdomain.workers.dev/mcp?apiKey=YOUR_MCP_API_KEY
```

If you use a custom domain:

```text
https://share.example.com/mcp?apiKey=YOUR_MCP_API_KEY
```

This Worker also accepts `Authorization: Bearer <token>`, but the simplest connection string is the URL above with `?apiKey=...`.

### Optional variable

- `PUBLIC_BASE_URL`

Set this only if you want generated page URLs and OG URLs to use a canonical custom domain such as `https://share.example.com`. If omitted, the Worker uses its own deployed origin by default.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars
npm run check
npm run build
npm run dev
```

## Manual deploy

```bash
npm install
npm run build
npx wrangler deploy
```

## Notes

- The Durable Object binding is provisioned automatically by Cloudflare during Deploy to Cloudflare setup.
- Shared pages are immutable and returned with long-lived cache headers.
- HTML pages are served as provided, with OG meta tags injected at response time.
- Markdown pages are prerendered and hydrated with the bundled client assets.
