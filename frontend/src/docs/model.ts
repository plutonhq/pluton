import { lexer } from 'marked';
import { docArticles } from './manifest.ts';

export type DocToken = {
   type: string;
   text?: string;
   raw?: string;
   depth?: number;
   lang?: string;
   href?: string;
   title?: string;
   tokens?: DocToken[];
   items?: DocToken[];
   ordered?: boolean;
   start?: number;
   task?: boolean;
   checked?: boolean;
   header?: { text: string; tokens: DocToken[] }[];
   rows?: { text: string; tokens: DocToken[] }[][];
   anchor?: string;
};
export type DocHeading = { id: string; text: string; depth: number };
export function parseDoc(markdown: string) {
   const tokens = lexer(markdown, { gfm: true }) as unknown as DocToken[];
   const headings: DocHeading[] = [];
   const used = new Map<string, number>();
   function visit(items: DocToken[]) {
      for (const token of items) {
         if (token.type === 'heading') {
            const base =
               (token.text || '')
                  .normalize('NFKD')
                  .toLowerCase()
                  .replace(/[^\p{L}\p{N}]+/gu, '-')
                  .replace(/^-|-$/g, '') || 'section';
            const count = used.get(base) || 0;
            used.set(base, count + 1);
            token.anchor = base + (count ? '-' + count : '');
            headings.push({ id: token.anchor, text: token.text || '', depth: token.depth || 2 });
         }
         if (token.tokens) visit(token.tokens);
         if (token.items) visit(token.items);
      }
   }
   visit(tokens);
   return { tokens, headings };
}
export function safeDocUrl(href?: string, image = false): string | undefined {
   if (!href || /[\x00-\x20\x7f\\]/.test(href)) return;
   if (image) return /^\/docs-assets\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|webp)$/i.test(href) ? href : undefined;
   if (href.startsWith('#') || /^\/docs(?:\/|#|$)/.test(href)) return href;
   try {
      const url = new URL(href);
      if (url.protocol === 'https:' && !url.username && !url.password && !/(?:^|\.)usepluton\.com$/i.test(url.hostname)) return url.href;
   } catch {
      /* No javascript:, data:, file:, protocol-relative or malformed links. */
   }
}
export function resolveDoc(pathname: string) {
   return docArticles.find((article) => '/docs/' + article.slug === pathname.replace(/\/$/, ''));
}
export function createDocsIndex(content: Record<string, string>) {
   return docArticles.map((article) => {
      const markdown = content[article.slug];
      if (!markdown) throw new Error(`Missing documentation article: ${article.slug}`);
      const parsed = parseDoc(markdown);
      return {
         ...article,
         markdown,
         ...parsed,
         searchText: (article.title + ' ' + parsed.headings.map((h) => h.text).join(' ') + ' ' + markdown).toLowerCase(),
      };
   });
}
export function searchDocs(index: ReturnType<typeof createDocsIndex>, query: string) {
   const terms = query.trim().toLowerCase().slice(0, 120).split(/\s+/).filter(Boolean);
   if (!terms.length) return [];
   return index
      .filter((article) => terms.every((term) => article.searchText.includes(term)))
      .map((article) => ({
         article,
         score: terms.reduce((score, term) => score + (article.title.toLowerCase().includes(term) ? 10 : 1), 0),
         excerpt: article.markdown
            .replace(/[#`*|]/g, '')
            .slice(
               Math.max(0, article.markdown.toLowerCase().indexOf(terms[0]) - 50),
               Math.max(0, article.markdown.toLowerCase().indexOf(terms[0]) - 50) + 220,
            ),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
}
export function validateDocLinks(index: ReturnType<typeof createDocsIndex>): string[] {
   const errors: string[] = [];
   function check(items: DocToken[], source: (typeof index)[number]) {
      for (const token of items) {
         if (token.type === 'link' || token.type === 'image') {
            const href = safeDocUrl(token.href, token.type === 'image');
            if (!href) errors.push(`${source.slug}: unsafe/unsupported URL`);
            else if (token.type === 'link' && (href.startsWith('#') || /^\/docs(?:\/|#|$)/.test(href))) {
               const [route, fragment] = href.split('#');
               const target = route ? index.find((article) => '/docs/' + article.slug === route) : source;
               if (route !== '/docs' && !target) errors.push(`${source.slug}: missing route ${route}`);
               if (fragment) {
                  try {
                     if (!target || !target.headings.some((h) => h.id === decodeURIComponent(fragment)))
                        errors.push(`${source.slug}: missing anchor ${href}`);
                  } catch {
                     errors.push(`${source.slug}: malformed anchor`);
                  }
               }
            }
         }
         if (token.tokens) check(token.tokens, source);
         if (token.items) check(token.items, source);
         for (const row of [token.header, ...(token.rows || [])]) for (const cell of row || []) check(cell.tokens, source);
      }
   }
   for (const article of index) check(article.tokens, article);
   return errors;
}
