import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import {
  createLocalSearch,
  readArticles,
  preserveMarkdown,
} from "../plugins/content.ts";
import { copyCode } from "../src/clipboard.ts";

test("React major versions stay isolated across documents", () => {
  const app = createRequire(
    new URL("../../frontend/package.json", import.meta.url),
  );
  const docs = createRequire(new URL("../package.json", import.meta.url));
  assert.equal(app("react").version.split(".")[0], "18");
  assert.equal(docs("react").version.split(".")[0], "19");
  assert.notEqual(app.resolve("react"), docs.resolve("react"));
  for (const name of [
    "react-router",
    "@tanstack/react-query",
    "@tanstack/react-query-devtools",
    "@tanstack/react-query-persist-client",
    "react-chartjs-2",
    "react-toastify",
    "react-tooltip",
  ]) {
    const declarations = createRequire(
      realpathSync(
        new URL(
          `../../frontend/node_modules/${name}/package.json`,
          import.meta.url,
        ),
      ),
    );
    assert.equal(
      declarations("@types/react/package.json").version.split(".")[0],
      "18",
      name,
    );
  }
});

test("official static search indexes original article body and stable fragments locally", async () => {
  const search = createLocalSearch();
  for (const [query, slug] of [
    ["HMAC", "notifications/webhook"],
    ["1044", "troubleshooting/database"],
    ["incremental", "backup-plans/incremental"],
  ]) {
    const results = await search.search(query, { locale: "id" });
    assert(
      results.some((result) => result.url.startsWith("/docs/" + slug)),
      query,
    );
    assert(results.every((result) => result.url.startsWith("/docs/")));
  }
  const response = await search.staticGET();
  assert.equal(response.status, 200);
  assert((await response.text()).includes("troubleshooting/database"));
});

test("Markdown security plugin escapes raw HTML and refuses executable MDX nodes", () => {
  const html = { type: "html", value: '<img src=x onerror="alert(1)">' };
  preserveMarkdown()({ type: "root", children: [html] }, { value: html.value });
  assert.equal(html.type, "text");
  assert.throws(
    () =>
      preserveMarkdown()(
        { type: "mdxjsEsm", value: "export const bad = 1" },
        { value: "" },
      ),
    /not allowed/,
  );
  const root = {
    type: "root",
    children: [
      { type: "heading", depth: 1 },
      { type: "heading", depth: 2 },
      { type: "heading", depth: 2 },
    ],
  };
  preserveMarkdown()(root, { value: "# Title\n\n## Setup\n\n## Setup" });
  assert.deepEqual(
    root.children.map((node: any) => node.data.hProperties.id),
    ["title", "setup", "setup-1"],
  );
});

function clipboardFixture(success = true) {
  const calls: string[] = [];
  const field = {
    value: "",
    style: {},
    select: () => calls.push("select"),
    remove: () => calls.push("remove"),
  };
  const page = {
    activeElement: { focus: () => calls.push("focus") },
    createElement: () => field,
    body: { appendChild: () => calls.push("append") },
    execCommand: () => success,
  };
  return { calls, field, page: page as unknown as Document };
}
test("secure-context clipboard API is preferred", async () => {
  const fixture = clipboardFixture();
  let copied = "";
  await copyCode(
    "synthetic command",
    {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    } as Navigator,
    fixture.page,
  );
  assert.equal(copied, "synthetic command");
  assert.deepEqual(fixture.calls, []);
});
test("HTTP clipboard fallback copies and removes temporary DOM, preserving focus", async () => {
  for (const browser of [
    {},
    {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    },
  ]) {
    const fixture = clipboardFixture();
    await copyCode("synthetic command", browser as Navigator, fixture.page);
    assert.equal(fixture.field.value, "synthetic command");
    assert.deepEqual(fixture.calls, ["append", "select", "remove", "focus"]);
  }
});
test("clipboard failure cleans up and surfaces only safe fallback message", async () => {
  const fixture = clipboardFixture(false);
  await assert.rejects(
    copyCode("synthetic command", {} as Navigator, fixture.page),
    /Clipboard unavailable/,
  );
  assert.deepEqual(fixture.calls, ["append", "select", "remove", "focus"]);
});

test(
  "actual Fumadocs compilation preserves all 77 titles/routes/TOCs and renders official layout safely",
  { timeout: 120000 },
  async () => {
    const server = await createServer({
      root: new URL("../", import.meta.url).pathname.replace(
        /^\/([A-Za-z]:)/,
        "$1",
      ),
      server: { middlewareMode: true },
      appType: "custom",
    });
    try {
      const source = await server.ssrLoadModule("/src/source.ts");
      const app = await server.ssrLoadModule("/src/App.tsx");
      const { mdxComponents } = await server.ssrLoadModule("/src/mdx.tsx");
      // Exercise the same plain-Markdown policy on synthetic hostile HTML/URLs.
      // Compilation/runtime here is test-only; the browser receives build output.
      const compilerRequire = createRequire(
        realpathSync(
          new URL("../node_modules/fumadocs-mdx/package.json", import.meta.url),
        ),
      );
      const mdx = await import(
        pathToFileURL(compilerRequire.resolve("@mdx-js/mdx")).href
      );
      const jsx = await import("react/jsx-runtime");
      const compiled = await mdx.compile(
        "# Synthetic\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![remote](https://example.internal/image.png)\n\n- one\n- two\n\n```sh\necho synthetic\n```",
        {
          format: "md",
          outputFormat: "function-body",
          remarkPlugins: [preserveMarkdown],
        },
      );
      const { default: Content } = await mdx.run(String(compiled), jsx);
      const securityRouter = createMemoryRouter([
        {
          path: "/",
          element: createElement(
            app.DocsShell,
            null,
            createElement(Content, { components: mdxComponents }),
          ),
        },
      ]);
      const safeHtml = renderToStaticMarkup(
        createElement(RouterProvider, { router: securityRouter }),
      );
      assert(safeHtml.includes("&lt;script&gt;"));
      assert(!safeHtml.includes("<script>alert(1)"));
      assert(!safeHtml.includes('href="javascript:'));
      assert(!safeHtml.includes('src="https://example.internal'));
      assert(safeHtml.includes("<ul>") && safeHtml.includes("echo synthetic"));
      assert(safeHtml.includes("Salin kode"));
      securityRouter.dispose();
      for (const article of readArticles()) {
        const compiled = await source.loadArticle(article.slug);
        assert.equal(compiled.metadata.title, article.title);
        assert.deepEqual(
          compiled.data.toc.map((heading: any) => heading.url.slice(1)),
          article.headings
            .filter((heading) => heading.depth > 1)
            .map((heading) => heading.id),
          article.slug,
        );
      }
      for (const route of [
        "/docs",
        "/docs/getting-started",
        "/docs/notifications/webhook",
        "/docs/not-a-page",
      ]) {
        const router = createMemoryRouter(
          [
            {
              path: "/docs/*",
              loader: app.docsLoader,
              element: createElement(app.default),
            },
          ],
          { initialEntries: [route] },
        );
        if (!router.state.initialized)
          await new Promise<void>((resolve) => {
            const unsubscribe = router.subscribe((state) => {
              if (state.initialized) {
                unsubscribe();
                resolve();
              }
            });
          });
        assert.equal(router.state.errors, null, route);
        const html = renderToStaticMarkup(
          createElement(RouterProvider, { router }),
        );
        assert(html.includes("Back to Application"), route);
        assert(html.includes("Pluton Documentation"), route);
        assert(!/api\/settings|onerror=|javascript:/.test(html), route);
        if (route === "/docs/getting-started")
          assert(html.includes('id="mengenal-pluton-mandiri"'));
        router.dispose();
      }
    } finally {
      await server.close();
    }
  },
);

test("no external runtime search endpoint or remote image source is configured", () => {
  const search = readFileSync(
    new URL("../src/Search.tsx", import.meta.url),
    "utf8",
  );
  assert(/from:\s*["']\/docs\/search-index\.json["']/.test(search));
  assert(!/https?:\/\/|apiKey|cloud/.test(search));
});
