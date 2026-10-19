import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "documentation", "dist");
const target = path.join(root, "frontend", "dist", "docs");
if (!fs.existsSync(path.join(source, "index.html")))
  throw new Error(
    "Fumadocs build is missing; refusing an incomplete application artifact.",
  );
fs.cpSync(source, target, { recursive: true });
console.log("Bundled static Fumadocs output into frontend/dist/docs.");
