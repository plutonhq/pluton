import { useRef, useState, type ComponentProps } from "react";
import defaults from "fumadocs-ui/mdx";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Callout } from "fumadocs-ui/components/callout";
import { Check, Clipboard } from "lucide-react";
import { safeDocUrl } from "../../frontend/src/docs/model.ts";
import { copyCode } from "./clipboard.ts";

function Code(props: ComponentProps<typeof CodeBlock>) {
  const pre = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState("Salin kode");
  return (
    <CodeBlock
      {...props}
      icon={undefined}
      allowCopy={false}
      Actions={({ className }) => (
        <div className={className}>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-fd-accent focus-visible:ring-2"
            aria-label={status}
            onClick={async () => {
              try {
                await copyCode(pre.current?.textContent || "");
                setStatus("Tersalin");
              } catch {
                setStatus("Pilih teks untuk menyalin");
              }
            }}
          >
            {status === "Tersalin" ? (
              <Check className="size-4" />
            ) : (
              <Clipboard className="size-4" />
            )}
          </button>
          <span className="sr-only" aria-live="polite">
            {status}
          </span>
        </div>
      )}
    >
      <Pre ref={pre}>{props.children}</Pre>
    </CodeBlock>
  );
}

export const mdxComponents = {
  ...defaults,
  pre: Code,
  a: ({ href, children, ...props }: ComponentProps<"a">) => {
    const safe = safeDocUrl(href);
    return safe ? (
      <defaults.a {...props} href={safe} rel="noopener noreferrer">
        {children}
      </defaults.a>
    ) : (
      <span>{children}</span>
    );
  },
  img: ({ src, alt }: ComponentProps<"img">) => {
    const safe = typeof src === "string" ? safeDocUrl(src, true) : undefined;
    return safe ? (
      <img src={safe} alt={alt || ""} loading="lazy" />
    ) : (
      <span>{alt}</span>
    );
  },
  blockquote: ({ children }: ComponentProps<"blockquote">) => (
    <Callout type="info">{children}</Callout>
  ),
};
