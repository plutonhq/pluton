/** Copy only the static code presented by the bundled docs, including trusted-LAN HTTP. */
export async function copyCode(
  text: string,
  browser = navigator,
  page = document,
) {
  if (browser.clipboard?.writeText) {
    try {
      await browser.clipboard.writeText(text);
      return;
    } catch {
      /* User gesture fallback below. */
    }
  }
  const field = page.createElement("textarea");
  const focus = page.activeElement as HTMLElement | null;
  field.value = text;
  field.style.position = "fixed";
  field.style.opacity = "0";
  page.body.appendChild(field);
  try {
    field.select();
    if (!page.execCommand("copy")) throw new Error("Clipboard unavailable");
  } finally {
    field.remove();
    focus?.focus?.();
  }
}
