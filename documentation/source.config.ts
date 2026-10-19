import { defineConfig } from "fumadocs-mdx/config";
import { preserveMarkdown, removeBodyTitle } from "./plugins/content.ts";

export default defineConfig({
  mdxOptions: {
    format: "md",
    remarkImageOptions: false,
    remarkPlugins: (plugins) => [preserveMarkdown, removeBodyTitle, ...plugins],
  },
});
