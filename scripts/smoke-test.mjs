import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.TARGET_URL ?? "http://127.0.0.1:8787";
const apiKey = process.env.MCP_API_KEY;
const baseOrigin = new URL(baseUrl).origin;
const expectedPublicBaseUrl =
  process.env.EXPECTED_PUBLIC_BASE_URL ??
  (baseOrigin === "http://127.0.0.1:8787" || baseOrigin === "http://localhost:8787"
    ? baseOrigin
    : "https://share.beynar.dev");

if (!apiKey) {
  throw new Error("MCP_API_KEY is required.");
}

function buildMcpUrl(token) {
  const url = new URL("/mcp", baseUrl);
  if (token) {
    url.searchParams.set("apiKey", token);
  }

  return url;
}

function buildAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`
  };
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runNegativeHttpChecks() {
  const missingApiKeyResponse = await fetch(new URL("/mcp", baseUrl));
  assert.equal(missingApiKeyResponse.status, 401, "Missing token should return 401.");

  const wrongApiKeyResponse = await fetch(buildMcpUrl(), {
    headers: buildAuthHeaders(`${apiKey}-wrong`)
  });
  assert.equal(wrongApiKeyResponse.status, 401, "Wrong bearer token should return 401.");

  const wrongQueryApiKeyResponse = await fetch(buildMcpUrl(`${apiKey}-wrong`));
  assert.equal(wrongQueryApiKeyResponse.status, 401, "Wrong query token should return 401.");

  const unknownPageResponse = await fetch(new URL("/p/does-not-exist", baseUrl));
  assert.equal(unknownPageResponse.status, 404, "Unknown page should return 404.");
}

async function assertToolCatalog(client) {
  const toolsResult = await client.listTools();
  const toolNames = toolsResult.tools.map((tool) => tool.name);

  assert(toolNames.includes("share_content"), "share_content should be exposed.");
  assert(toolNames.includes("search_pages"), "search_pages should be exposed.");
  assert(!toolNames.includes("share_html"), "share_html should not be exposed anymore.");
}

async function runModeChecks(mode) {
  const client = new Client({
    name: "html-storage-smoke-test",
    version: "0.2.0"
  });
  const transport =
    mode === "bearer"
      ? new StreamableHTTPClientTransport(buildMcpUrl(), {
          requestInit: {
            headers: buildAuthHeaders(apiKey)
          }
        })
      : new StreamableHTTPClientTransport(buildMcpUrl(apiKey));

  try {
    await client.connect(transport);
    await assertToolCatalog(client);

    const htmlMarker = `html-marker-${mode}-${Date.now()}`;
    const htmlTitle = `HTML Share ${mode} ${Date.now()}`;
    const htmlLabel = `html-${mode}`;
    const rawHtml = `<!doctype html><html><body><h1>${htmlMarker}</h1></body></html>`;
    const htmlResult = await client.callTool({
      arguments: { html: rawHtml, label: htmlLabel, title: htmlTitle },
      name: "share_content"
    });

    assert.equal(htmlResult.isError, undefined, "HTML share should succeed.");
    assert.equal(htmlResult.structuredContent?.format, "html", "HTML result should report format.");
    assert.equal(htmlResult.structuredContent?.title, htmlTitle, "HTML title should round-trip.");
    assert.equal(htmlResult.structuredContent?.label, htmlLabel, "HTML label should round-trip.");
    assert.match(
      htmlResult.structuredContent?.url ?? "",
      new RegExp(`^${escapeForRegExp(expectedPublicBaseUrl)}/p/`, "u"),
      "HTML result should use the expected public base URL."
    );

    const htmlPageResponse = await fetch(htmlResult.structuredContent.url);
    assert.equal(htmlPageResponse.status, 200, "Shared HTML should be served.");
    assert.equal(
      htmlPageResponse.headers.get("content-type"),
      "text/html; charset=utf-8",
      "Shared HTML should be served as text/html."
    );
    const htmlPageHtml = await htmlPageResponse.text();
    assert.match(htmlPageHtml, new RegExp(htmlMarker, "u"), "HTML body content should still be present.");
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta property="og:image" content="${escapeForRegExp(new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString())}"`),
      "HTML page should include the OG image meta tag."
    );
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta property="og:title" content="${escapeForRegExp(htmlTitle)}"`),
      "HTML page should include the OG title meta tag."
    );
    assert.match(
      htmlPageHtml,
      new RegExp(`<meta name="twitter:image" content="${escapeForRegExp(new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString())}"`),
      "HTML page should include the Twitter image meta tag."
    );

    const htmlOgUrl = new URL(`/og/${htmlResult.structuredContent.id}.png`, expectedPublicBaseUrl).toString();
    const htmlOgResponse = await fetch(htmlOgUrl);
    assert.equal(htmlOgResponse.status, 200, "HTML OG image should be served.");
    assert.equal(htmlOgResponse.headers.get("content-type"), "image/png", "OG route should serve PNG.");

    const markdownMarker = `markdown-marker-${mode}-${Date.now()}`;
    const markdownTitle = `Markdown Share ${mode} ${Date.now()}`;
    const markdownLabel = `markdown-${mode}`;
    const markdown = [
      `# ${markdownMarker}`,
      "",
      "Mermaid:",
      "",
      "```mermaid",
      "graph TD",
      "  A[Start] --> B[Ship]",
      "```",
      "",
      "Math: $E=mc^2$",
      "",
      "CJK: 你好，世界"
    ].join("\n");
    const markdownResult = await client.callTool({
      arguments: { label: markdownLabel, markdown, title: markdownTitle },
      name: "share_content"
    });

    assert.equal(markdownResult.isError, undefined, "Markdown share should succeed.");
    assert.equal(
      markdownResult.structuredContent?.format,
      "markdown",
      "Markdown result should report format."
    );
    assert.equal(
      markdownResult.structuredContent?.title,
      markdownTitle,
      "Markdown title should round-trip."
    );
    assert.equal(
      markdownResult.structuredContent?.label,
      markdownLabel,
      "Markdown label should round-trip."
    );
    assert.match(
      markdownResult.structuredContent?.url ?? "",
      new RegExp(`^${escapeForRegExp(expectedPublicBaseUrl)}/p/`, "u"),
      "Markdown result should use the expected public base URL."
    );

    const markdownPageResponse = await fetch(markdownResult.structuredContent.url);
    assert.equal(markdownPageResponse.status, 200, "Markdown page should be served.");
    const markdownPageHtml = await markdownPageResponse.text();
    assert.match(markdownPageHtml, new RegExp(markdownMarker, "u"), "Markdown heading should be present.");
    assert.match(
      markdownPageHtml,
      /id="markdown-share-data"/u,
      "Markdown page should include hydration bootstrap data."
    );
    assert.match(
      markdownPageHtml,
      /src="\/assets\/markdown-page\.js"/u,
      "Markdown page should include the markdown client bundle."
    );
    assert.match(
      markdownPageHtml,
      /href="\/assets\/markdown-page\.css"/u,
      "Markdown page should include the markdown stylesheet."
    );
    assert.match(markdownPageHtml, new RegExp(markdownTitle, "u"), "Markdown page title should be present.");
    const markdownOgUrl = new URL(
      `/og/${markdownResult.structuredContent.id}.png`,
      expectedPublicBaseUrl
    ).toString();
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta property="og:image" content="${escapeForRegExp(markdownOgUrl)}"`),
      "Markdown page should include the OG image meta tag."
    );
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta name="twitter:image" content="${escapeForRegExp(markdownOgUrl)}"`),
      "Markdown page should include the Twitter image meta tag."
    );
    assert.match(
      markdownPageHtml,
      new RegExp(`<meta property="og:title" content="${escapeForRegExp(markdownTitle)}"`),
      "Markdown page should include the OG title meta tag."
    );

    const markdownOgResponse = await fetch(markdownOgUrl);
    assert.equal(markdownOgResponse.status, 200, "Markdown OG image should be served.");
    assert.equal(
      markdownOgResponse.headers.get("content-type"),
      "image/png",
      "Markdown OG route should serve PNG."
    );

    const searchByLabelResult = await client.callTool({
      arguments: { query: markdownLabel },
      name: "search_pages"
    });
    assert.equal(searchByLabelResult.isError, undefined, "Searching by label should succeed.");
    assert(
      searchByLabelResult.structuredContent?.pages?.some(
        (page) => page.id === markdownResult.structuredContent.id && page.label === markdownLabel
      ),
      "Search should find the markdown page by label."
    );

    const searchByIdResult = await client.callTool({
      arguments: { query: htmlResult.structuredContent.id, limit: 5 },
      name: "search_pages"
    });
    assert.equal(searchByIdResult.isError, undefined, "Searching by id should succeed.");
    assert(
      searchByIdResult.structuredContent?.pages?.some(
        (page) => page.id === htmlResult.structuredContent.id && page.title === htmlTitle
      ),
      "Search should find the HTML page by id."
    );

    const bothResult = await client.callTool({
      arguments: {
        html: "<p>html</p>",
        markdown: "# markdown"
      },
      name: "share_content"
    });
    assert.equal(bothResult.isError, true, "Providing html and markdown together should fail.");

    const emptyResult = await client.callTool({
      arguments: {},
      name: "share_content"
    });
    assert.equal(emptyResult.isError, true, "Providing neither html nor markdown should fail.");

    const oversizedHtmlResult = await client.callTool({
      arguments: { html: "x".repeat(1024 * 1024 + 1) },
      name: "share_content"
    });
    assert.equal(oversizedHtmlResult.isError, true, "Oversized HTML should fail.");

    const oversizedMarkdownResult = await client.callTool({
      arguments: { markdown: "x".repeat(1024 * 1024 + 1) },
      name: "share_content"
    });
    assert.equal(oversizedMarkdownResult.isError, true, "Oversized markdown should fail.");

    const badLabelResult = await client.callTool({
      arguments: { html: "<p>bad</p>", label: "two words" },
      name: "share_content"
    });
    assert.equal(badLabelResult.isError, true, "Multi-word label should fail.");
  } finally {
    await transport.close();
    await client.close();
  }
}

await runNegativeHttpChecks();
await runModeChecks("bearer");
await runModeChecks("query");

console.log(`Smoke test passed against ${baseUrl}`);
