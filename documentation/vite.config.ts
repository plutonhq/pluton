import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { publicArtifacts } from "./plugins/content.ts";

export default defineConfig({
  base: "/docs/",
  plugins: [
    fumadocsMdx({ macro: { include: ["**/src/source.ts"] } }),
    react(),
    tailwindcss(),
    publicArtifacts(),
  ],
  resolve: { dedupe: ["react", "react-dom", "react-router"] },
  ssr: { noExternal: ["fumadocs-core", "fumadocs-ui"] },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
