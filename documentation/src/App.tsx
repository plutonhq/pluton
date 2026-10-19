import { useEffect, useState, type ReactNode } from "react";
import { useLoaderData, useLocation } from "react-router";
import { RootProvider } from "fumadocs-ui/provider/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsPage,
  DocsTitle,
  DocsDescription,
  DocsBody,
} from "fumadocs-ui/layouts/docs/page";
import { Cards, Card } from "fumadocs-ui/components/card";
import { Callout } from "fumadocs-ui/components/callout";
import { BookOpen, ArrowUpRight } from "lucide-react";
import {
  docArticles,
  docCategories,
  supportLabels,
} from "../../frontend/src/docs/manifest.ts";
import { buildIdentity } from "../../frontend/src/utils/buildIdentity.ts";
import { tree, loadArticle } from "./source.ts";
import { mdxComponents } from "./mdx.tsx";
import { ThemeCompatibility } from "./theme.tsx";
import LocalSearch from "./Search.tsx";

export async function docsLoader({ request }: { request: Request }) {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "");
  if (pathname === "/docs") return { home: true, article: null };
  return {
    home: false,
    article: await loadArticle(pathname.slice("/docs/".length)),
  };
}

function Footer() {
  const [identity, setIdentity] = useState("Development build");
  useEffect(() => {
    const abort = new AbortController();
    // Public static-document response metadata only, not inventory or authenticated APIs.
    fetch("/docs/", {
      method: "HEAD",
      credentials: "omit",
      signal: abort.signal,
    })
      .then((response) => {
        if (response.ok)
          setIdentity(
            buildIdentity(
              response.headers.get("X-App-Version"),
              response.headers.get("X-App-Revision"),
            ),
          );
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return (
    <footer className="pluton-footer text-center">
      Pluton | <a href="/docs">Documentation</a> |{" "}
      <a href="/docs/changelog">Changelog</a> |{" "}
      <a href="/docs/reference/version">{identity}</a> |{" "}
      <a href="/docs/reference/acknowledgements">About</a>
      <div className="mt-2">
        <a href="/docs/licenses/third-party.txt">
          Fumadocs &amp; third-party license notices
        </a>
      </div>
    </footer>
  );
}

export function DocsShell({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{
        storageKey: "pluton-docs-theme",
        defaultTheme: "system",
        attribute: "class",
      }}
      search={{ SearchDialog: LocalSearch }}
      i18n={{
        locale: "id",
        translations: {
          "Search(search trigger)": "Cari",
          "Search(search dialog)": "Cari dokumentasi",
          "On this page(table of contents)": "Di halaman ini",
          "Next Page(pagination)": "Berikutnya",
          "Previous Page(pagination)": "Sebelumnya",
        },
      }}
    >
      <ThemeCompatibility />
      <DocsLayout
        tree={tree}
        tabs={false}
        nav={{
          url: "/docs",
          title: (
            <>
              <BookOpen className="size-5" />
              <span>Pluton Documentation</span>
            </>
          ),
        }}
        sidebar={{
          defaultOpenLevel: 0,
          prefetch: false,
          footer: (
            <a
              className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-fd-accent"
              href="/"
            >
              Back to Application <ArrowUpRight className="size-4" />
            </a>
          ),
        }}
        links={[
          {
            type: "custom",
            children: (
              <a href="/" className="text-sm">
                Back to Application
              </a>
            ),
          },
        ]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}

export default function Docs() {
  const { home, article } = useLoaderData() as Awaited<
    ReturnType<typeof docsLoader>
  >;
  const location = useLocation();
  useEffect(() => {
    document.title = `${article?.metadata.title || "Documentation"} · Pluton`;
    try {
      const anchor = decodeURIComponent(location.hash.slice(1));
      if (anchor) document.getElementById(anchor)?.scrollIntoView();
      else window.scrollTo(0, 0);
    } catch {
      /* Malformed fragments cannot crash navigation. */
    }
  }, [location.pathname, location.hash, article]);

  if (home)
    return (
      <DocsShell>
        <DocsPage
          full
          footer={{ enabled: false }}
          breadcrumb={{ enabled: false }}
        >
          <DocsTitle>Pluton Documentation</DocsTitle>
          <DocsDescription>
            Panduan operasional Bahasa Indonesia untuk platform backup
            self-hosted Anda.
          </DocsDescription>
          <DocsBody>
            <p>
              Backup, Remote Agent, Database Lifecycle, staged Restore, Recovery
              Testing, serta Webhook &amp; Email—dalam deployment Pluton yang
              sama. Cari topik dengan Ctrl+K / Cmd+K.
            </p>
            <Callout title="Mulai dengan aman" type="info">
              Gunakan contoh sintetis dan staging. Backup Complete bukan bukti
              Recovery Passed; panduan keamanan dan batas dukungan tetap
              berlaku.
            </Callout>
            <Cards>
              {docCategories.map((category) => (
                <Card
                  key={category.id}
                  title={category.title}
                  href={"/docs/" + category.articles[0].slug}
                >
                  {category.articles.length} panduan ·{" "}
                  {category.articles[0].title}
                </Card>
              ))}
            </Cards>
          </DocsBody>
          <Footer />
        </DocsPage>
      </DocsShell>
    );

  if (!article)
    return (
      <DocsShell>
        <DocsPage footer={{ enabled: false }}>
          <DocsTitle>Artikel tidak ditemukan</DocsTitle>
          <DocsDescription>
            Gunakan search atau sidebar untuk menemukan panduan yang tersedia.
          </DocsDescription>
          <DocsBody>
            <a href="/docs">Kembali ke Documentation</a>
          </DocsBody>
          <Footer />
        </DocsPage>
      </DocsShell>
    );

  const { metadata, data, entry } = article;
  const ordinal = docArticles.findIndex((item) => item.slug === metadata.slug);
  const page = (offset: number) => {
    const item = docArticles[ordinal + offset];
    return item ? { name: item.title, url: "/docs/" + item.slug } : undefined;
  };
  const Body = entry.body;
  const titleAnchor = metadata.title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return (
    <DocsShell>
      <DocsPage
        toc={data.toc}
        breadcrumb={{ includeRoot: true, includePage: true }}
        tableOfContent={{ style: "clerk" }}
        footer={{ items: { previous: page(-1), next: page(1) } }}
      >
        <DocsTitle id={titleAnchor}>{metadata.title}</DocsTitle>
        <DocsDescription>{metadata.categoryTitle}</DocsDescription>
        <DocsBody>
          {metadata.support !== "implemented" && (
            <Callout title={supportLabels[metadata.support]} type="warn">
              Perhatikan setup operator, validasi dan batas dukungan dalam
              panduan berikut.
            </Callout>
          )}
          <Body components={mdxComponents} />
        </DocsBody>
        <Footer />
      </DocsPage>
    </DocsShell>
  );
}
