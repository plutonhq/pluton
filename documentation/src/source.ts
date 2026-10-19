import { defineDocs } from "fumadocs-mdx/macro";
import { pageSchema } from "fumadocs-core/source/schema";
import {
  docArticles,
  docCategories,
} from "../../frontend/src/docs/manifest.ts";
import type { Root } from "fumadocs-core/page-tree";

export const collection = defineDocs({
  dir: "../frontend/src/docs/articles",
  docs: {
    async: true,
    schema: ({ path }) => {
      const normalized = path.replaceAll("\\", "/");
      const article = docArticles.find(
        (a) =>
          normalized === a.slug + ".md" ||
          normalized.endsWith("/" + a.slug + ".md"),
      );
      if (!article)
        throw new Error(
          "Markdown file is not registered in the Pluton manifest.",
        );
      return pageSchema.extend({
        title: pageSchema.shape.title.default(article.title),
      });
    },
  },
});

const item = (article: (typeof docArticles)[number]) => ({
  type: "page" as const,
  name: article.title,
  url: "/docs/" + article.slug,
});
export const tree: Root = {
  name: "Pluton Documentation",
  children: [
    { type: "page", name: "Documentation", url: "/docs" },
    ...docCategories.map((category) => ({
      type: "folder" as const,
      name: category.title,
      index: item(
        docArticles.find((a) => a.slug === category.articles[0].slug)!,
      ),
      children: category.articles
        .slice(1)
        .map((a) => item(docArticles.find((page) => page.slug === a.slug)!)),
    })),
  ],
};

export async function loadArticle(slug: string) {
  const metadata = docArticles.find((article) => article.slug === slug);
  if (!metadata) return null;
  const entry = collection.getPage(slug + ".md");
  if (!entry)
    throw new Error(
      "Registered documentation article is missing from the compiled source.",
    );
  await entry.preload();
  const data = await entry.load();
  return { metadata, entry, data };
}
