import { hydrateRoot } from "react-dom/client";

import {
  MarkdownPageApp,
  MARKDOWN_APP_ELEMENT_ID,
  MARKDOWN_BOOTSTRAP_ELEMENT_ID,
  type MarkdownPagePayload
} from "../markdown-page";

const appElement = document.getElementById(MARKDOWN_APP_ELEMENT_ID);
const bootstrapElement = document.getElementById(MARKDOWN_BOOTSTRAP_ELEMENT_ID);

if (!appElement || !bootstrapElement?.textContent) {
  throw new Error("Markdown page bootstrap data is missing.");
}

const payload = JSON.parse(bootstrapElement.textContent) as MarkdownPagePayload;

hydrateRoot(appElement, <MarkdownPageApp {...payload} />, {
  onRecoverableError: () => {}
});
