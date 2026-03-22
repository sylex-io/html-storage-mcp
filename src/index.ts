import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { DurableObject } from "cloudflare:workers";
import { getPublicOrigin } from "mcp-handler";
import { timingSafeEqual } from "node:crypto";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { z } from "zod";

import {
  MarkdownPageApp,
  MARKDOWN_APP_ELEMENT_ID,
  MARKDOWN_BOOTSTRAP_ELEMENT_ID,
  type MarkdownPagePayload
} from "./markdown-page";
import { createOgImageResponse } from "./og-image";

const HTML_STORAGE_NAME = "html-storage";
const MARKDOWN_PAGE_SCRIPT_PATH = "/assets/markdown-page.js";
const MARKDOWN_PAGE_STYLE_PATH = "/assets/markdown-page.css";
const MAX_CONTENT_BYTES = 1024 * 1024;
const PAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_HTML_TITLE = "Shared HTML";
const DEFAULT_MARKDOWN_TITLE = "Shared Markdown";
const MARKDOWN_FAVICON_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23b85c38'/%3E%3Cpath d='M17 45V19h10.5l7 15 7-15H52v26h-7.5V29.5L37 45h-5l-7.5-15.5V45z' fill='%23f7efe5'/%3E%3C/svg%3E";

type StoredFormat = "html" | "markdown";

type ShareContentInput = {
  html?: string;
  label?: string;
  markdown?: string;
  title?: string;
};

type StorePageResult = {
  createdAt: number;
  format: StoredFormat;
  id: string;
};

type PageRow = {
  html: string;
};

type PageMetadataRow = {
  created_at: number;
  format: StoredFormat;
  id: string;
  label: string | null;
  title: string | null;
};

type PageRecord = PageMetadataRow & {
  html: string;
};

type SearchPagesInput = {
  limit?: number;
  query?: string;
};

type SearchPageRow = {
  created_at: number;
  format: StoredFormat;
  id: string;
  label: string | null;
  title: string | null;
};

type TableInfoRow = {
  name: string;
};

type HtmlStorageStub = ReturnType<Env["HTML_STORAGE"]["getByName"]> & {
  getPage(id: string): Promise<PageRecord | null>;
  getPageMetadata(id: string): Promise<PageMetadataRow | null>;
  searchPages(query?: string, limit?: number): Promise<SearchPageRow[]>;
  storePage(
    format: StoredFormat,
    html: string,
    source: string | null,
    title: string | null,
    label: string | null
  ): Promise<StorePageResult>;
};

const textEncoder = new TextEncoder();

function getStorageStub(env: Env): HtmlStorageStub {
  return env.HTML_STORAGE.getByName(HTML_STORAGE_NAME) as HtmlStorageStub;
}

function getConfiguredString(env: Env, key: "MCP_API_KEY" | "PUBLIC_BASE_URL"): string | null {
  const value = Reflect.get(env as object, key) as unknown;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getConfiguredApiKey(env: Env): string {
  const value = getConfiguredString(env, "MCP_API_KEY");
  if (value === null) {
    throw new Error("MCP_API_KEY secret is not configured");
  }

  return value;
}

function getProvidedToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerMatch = authorization.match(/^Bearer (.+)$/u);
  if (bearerMatch?.[1]) {
    return bearerMatch[1];
  }

  return new URL(request.url).searchParams.get("apiKey") ?? "";
}

function verifyAccessToken(request: Request, env: Env): boolean {
  const expected = Buffer.from(getConfiguredApiKey(env));
  const provided = Buffer.from(getProvidedToken(request));

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}

function getTextSize(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function generatePageId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /unique|constraint|primary key/i.test(error.message);
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function getPublicBaseUrl(env: Env, requestOrigin: string): string {
  if (
    requestOrigin.startsWith("http://127.0.0.1") ||
    requestOrigin.startsWith("http://localhost")
  ) {
    return requestOrigin;
  }

  return getConfiguredString(env, "PUBLIC_BASE_URL") ?? requestOrigin;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForHtml(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_`~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function deriveMarkdownTitle(markdown: string): string {
  const headingMatch = markdown.match(/^\s*#\s+(.+?)\s*$/mu);
  if (!headingMatch) {
    return DEFAULT_MARKDOWN_TITLE;
  }

  const title = stripMarkdownInline(headingMatch[1]);
  return title.length > 0 ? title : DEFAULT_MARKDOWN_TITLE;
}

function getDefaultTitle(format: StoredFormat): string {
  return format === "html" ? DEFAULT_HTML_TITLE : DEFAULT_MARKDOWN_TITLE;
}

function normalizeOptionalTitle(title: string | undefined, fallback?: string): string | null {
  const normalized = title?.trim();
  if (normalized && normalized.length > 0) {
    return normalized;
  }

  return fallback ?? null;
}

function normalizeOptionalLabel(label: string | undefined): string | null {
  const normalized = label?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[a-z0-9-]+$/u.test(normalized)) {
    throw new Error("Label must be a single word using letters, numbers, or hyphens.");
  }

  return normalized;
}

function renderMarkdownDocument(markdown: string, title: string): string {
  const payload: MarkdownPagePayload = {
    markdown,
    title
  };
  const appHtml = renderToString(createElement(MarkdownPageApp, payload));
  const bootstrapJson = escapeJsonForHtml(JSON.stringify(payload));

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="color-scheme" content="light" />',
    `<link rel="icon" href="${MARKDOWN_FAVICON_DATA_URL}" />`,
    `<title>${escapeHtml(payload.title)}</title>`,
    `<link rel="stylesheet" href="${MARKDOWN_PAGE_STYLE_PATH}" />`,
    "</head>",
    "<body>",
    `<div id="${MARKDOWN_APP_ELEMENT_ID}">${appHtml}</div>`,
    `<script id="${MARKDOWN_BOOTSTRAP_ELEMENT_ID}" type="application/json">${bootstrapJson}</script>`,
    `<script type="module" src="${MARKDOWN_PAGE_SCRIPT_PATH}"></script>`,
    "</body>",
    "</html>"
  ].join("");
}

function buildOgImageUrl(publicBaseUrl: string, pageId: string): string {
  return `${publicBaseUrl}/og/${pageId}.png`;
}

function buildPageUrl(publicBaseUrl: string, pageId: string): string {
  return `${publicBaseUrl}/p/${pageId}`;
}

function injectSocialMetaTags(
  html: string,
  options: {
    ogImageUrl: string;
    pageTitle: string;
    pageUrl: string;
  }
): string {
  const socialMetaTags = [
    `<meta property="og:image" content="${escapeHtml(options.ogImageUrl)}" />`,
    `<meta property="og:title" content="${escapeHtml(options.pageTitle)}" />`,
    '<meta property="og:type" content="article" />',
    `<meta property="og:url" content="${escapeHtml(options.pageUrl)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(options.pageTitle)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(options.ogImageUrl)}" />`
  ].join("");

  if (html.includes("</head>")) {
    return html.replace("</head>", `${socialMetaTags}</head>`);
  }

  const htmlTagMatch = html.match(/<html\b[^>]*>/iu);
  if (htmlTagMatch) {
    return html.replace(
      htmlTagMatch[0],
      `${htmlTagMatch[0]}<head>${socialMetaTags}</head>`
    );
  }

  return html;
}

function normalizeShareContent(input: ShareContentInput): {
  format: StoredFormat;
  html: string;
  label: string | null;
  source: string;
  title: string | null;
} {
  const html = input.html?.trim();
  const markdown = input.markdown?.trim();
  const label = normalizeOptionalLabel(input.label);

  if (html && markdown) {
    throw new Error("Provide either html or markdown, not both.");
  }

  if (!html && !markdown) {
    throw new Error("Provide either html or markdown.");
  }

  if (html) {
    if (getTextSize(html) > MAX_CONTENT_BYTES) {
      throw new Error(`HTML exceeds the ${MAX_CONTENT_BYTES} byte limit.`);
    }

    return {
      format: "html",
      html,
      label,
      source: html,
      title: normalizeOptionalTitle(input.title, DEFAULT_HTML_TITLE)
    };
  }

  if (!markdown) {
    throw new Error("Provide either html or markdown.");
  }

  if (getTextSize(markdown) > MAX_CONTENT_BYTES) {
    throw new Error(`Markdown exceeds the ${MAX_CONTENT_BYTES} byte limit.`);
  }

  const title = normalizeOptionalTitle(input.title, deriveMarkdownTitle(markdown));

  return {
    format: "markdown",
    html: renderMarkdownDocument(markdown, title ?? DEFAULT_MARKDOWN_TITLE),
    label,
    source: markdown,
    title
  };
}

function createMcpServer(env: Env, publicBaseUrl: string): McpServer {
  const server = new McpServer({
    name: "html-storage-mcp",
    version: "0.2.0"
  });

  server.registerTool(
    "share_content",
    {
      description: "Share HTML or markdown and return its public URL.",
      inputSchema: {
        html: z.string().optional(),
        label: z.string().optional(),
        markdown: z.string().optional(),
        title: z.string().optional()
      },
      title: "Share Content"
    },
    async (input: ShareContentInput) => {
      const { format, html, label, source, title } = normalizeShareContent(input);
      const { createdAt, id } = await getStorageStub(env).storePage(
        format,
        html,
        source,
        title,
        label
      );
      const url = buildPageUrl(publicBaseUrl, id);

      return {
        content: [
          {
            text: `Shared ${format} page ${id} at ${url}`,
            type: "text"
          }
        ],
        structuredContent: {
          createdAt,
          format,
          id,
          label,
          title,
          url
        }
      };
    }
  );

  server.registerTool(
    "search_pages",
    {
      description: "Search shared pages by title, label, or id and return matching page ids.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        query: z.string().optional()
      },
      title: "Search Pages"
    },
    async (input: SearchPagesInput) => {
      const pages = await getStorageStub(env).searchPages(input.query, input.limit);

      return {
        content: [
          {
            text:
              pages.length === 0
                ? "No shared pages matched."
                : `Found ${pages.length} shared page${pages.length === 1 ? "" : "s"}.`,
            type: "text"
          }
        ],
        structuredContent: {
          pages: pages.map((page) => ({
            createdAt: page.created_at,
            format: page.format,
            id: page.id,
            label: page.label,
            title: page.title,
            url: `${publicBaseUrl}/p/${page.id}`
          }))
        }
      };
    }
  );

  return server;
}

export class HtmlStorageDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY,
          format TEXT NOT NULL DEFAULT 'html',
          source TEXT,
          html TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      const columns = new Set(
        this.ctx.storage.sql.exec<TableInfoRow>("PRAGMA table_info(pages)").toArray().map((row) => row.name)
      );

      if (!columns.has("format")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE pages ADD COLUMN format TEXT NOT NULL DEFAULT 'html'"
        );
      }

      if (!columns.has("source")) {
        this.ctx.storage.sql.exec("ALTER TABLE pages ADD COLUMN source TEXT");
      }

      if (!columns.has("title")) {
        this.ctx.storage.sql.exec("ALTER TABLE pages ADD COLUMN title TEXT");
      }

      if (!columns.has("label")) {
        this.ctx.storage.sql.exec("ALTER TABLE pages ADD COLUMN label TEXT");
      }
    });
  }

  async getPage(id: string): Promise<PageRecord | null> {
    const row = this.ctx.storage.sql
      .exec<PageRecord>(
        "SELECT id, format, title, label, created_at, html FROM pages WHERE id = ? LIMIT 1",
        id
      )
      .toArray()[0];

    return row ?? null;
  }

  async getPageMetadata(id: string): Promise<PageMetadataRow | null> {
    const row = this.ctx.storage.sql
      .exec<PageMetadataRow>(
        "SELECT id, format, title, label, created_at FROM pages WHERE id = ? LIMIT 1",
        id
      )
      .toArray()[0];

    return row ?? null;
  }

  async storePage(
    format: StoredFormat,
    html: string,
    source: string | null,
    title: string | null,
    label: string | null
  ): Promise<StorePageResult> {
    const createdAt = Date.now();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = generatePageId();

      try {
        this.ctx.storage.sql.exec(
          "INSERT INTO pages (id, format, source, html, created_at, title, label) VALUES (?, ?, ?, ?, ?, ?, ?)",
          id,
          format,
          source,
          html,
          createdAt,
          title,
          label
        );

        return { createdAt, format, id };
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue;
        }

        throw error;
      }
    }

    throw new Error("Failed to allocate a unique page id.");
  }

  async searchPages(query?: string, limit = 20): Promise<SearchPageRow[]> {
    const normalizedLimit = Math.max(1, Math.min(limit, 100));
    const normalizedQuery = query?.trim();

    if (!normalizedQuery) {
      return this.ctx.storage.sql
        .exec<SearchPageRow>(
          "SELECT id, format, title, label, created_at FROM pages ORDER BY created_at DESC LIMIT ?",
          normalizedLimit
        )
        .toArray();
    }

    const likeQuery = `%${normalizedQuery.toLowerCase()}%`;

    return this.ctx.storage.sql
      .exec<SearchPageRow>(
        `SELECT id, format, title, label, created_at
         FROM pages
         WHERE lower(id) LIKE ?
            OR lower(coalesce(title, '')) LIKE ?
            OR lower(coalesce(label, '')) LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`,
        likeQuery,
        likeQuery,
        likeQuery,
        normalizedLimit
      )
      .toArray();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/healthz") {
      return jsonResponse({
        durableObject: HTML_STORAGE_NAME,
        ok: true,
        service: "html-storage-mcp"
      });
    }

    if (pathname === "/mcp") {
      try {
        if (!verifyAccessToken(request, env)) {
          return jsonResponse({ error: "Unauthorized" }, { status: 401 });
        }
      } catch (error) {
        console.error("MCP auth configuration error", error);
        return jsonResponse({ error: "Server misconfigured" }, { status: 500 });
      }

      const publicBaseUrl = getPublicBaseUrl(env, getPublicOrigin(request));
      const server = createMcpServer(env, publicBaseUrl);
      const transport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse: true,
        sessionIdGenerator: undefined
      });

      try {
        await server.connect(transport);
        return await transport.handleRequest(request);
      } catch (error) {
        console.error("Error handling MCP request", error);
        return jsonResponse(
          {
            error: {
              code: -32603,
              message: "Internal server error"
            },
            id: null,
            jsonrpc: "2.0"
          },
          { status: 500 }
        );
      } finally {
        await transport.close();
        await server.close();
      }
    }

    const pageMatch = pathname.match(/^\/p\/([^/]+)$/u);
    if (pageMatch) {
      const pageId = decodeURIComponent(pageMatch[1]);
      const page = await getStorageStub(env).getPage(pageId);

      if (page === null) {
        return new Response("Not Found", { status: 404 });
      }

      const publicBaseUrl = getPublicBaseUrl(env, url.origin);
      const html = injectSocialMetaTags(page.html, {
        ogImageUrl: buildOgImageUrl(publicBaseUrl, pageId),
        pageTitle: page.title ?? getDefaultTitle(page.format),
        pageUrl: buildPageUrl(publicBaseUrl, pageId)
      });

      return new Response(html, {
        headers: {
          "Cache-Control": PAGE_CACHE_CONTROL,
          "Content-Type": "text/html; charset=utf-8"
        }
      });
    }

    const ogMatch = pathname.match(/^\/og\/([^/]+)\.png$/u);
    if (ogMatch) {
      const pageId = decodeURIComponent(ogMatch[1]);
      const page = await getStorageStub(env).getPageMetadata(pageId);

      if (page === null) {
        return new Response("Not Found", { status: 404 });
      }

      return await createOgImageResponse({
        label: page.label,
        title: page.title ?? getDefaultTitle(page.format)
      });
    }

    return new Response("Not Found", { status: 404 });
  }
};
