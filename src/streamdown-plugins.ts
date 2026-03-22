import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";

const markdownMath = createMathPlugin({
  singleDollarTextMath: true
});

const markdownMermaid = createMermaidPlugin({
  config: {
    theme: "neutral"
  }
});

export const markdownPlugins = {
  cjk,
  code,
  math: markdownMath,
  mermaid: markdownMermaid
};
