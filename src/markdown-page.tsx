import { Streamdown } from "streamdown";

import { markdownPlugins } from "./streamdown-plugins";

export const MARKDOWN_APP_ELEMENT_ID = "markdown-share-app";
export const MARKDOWN_BOOTSTRAP_ELEMENT_ID = "markdown-share-data";

export type MarkdownPagePayload = {
  markdown: string;
  title: string;
};

export function MarkdownPageApp({ markdown }: MarkdownPagePayload) {
  return (
    <div className="min-h-screen bg-white text-[color:var(--foreground)]">
      <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12 sm:px-12 lg:py-16">
        <article className="streamdown-shell overflow-hidden border border-[color:var(--shell-line)] bg-white px-6 py-8 sm:px-12 sm:py-12">
          <Streamdown className="share-markdown" mode="static" plugins={markdownPlugins}>
            {markdown}
          </Streamdown>
        </article>
      </main>
    </div>
  );
}
