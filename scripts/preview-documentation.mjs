// Disposable localhost static preview only: no Pluton services, database, identity or secrets.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registerSpaFallback } from "../backend/src/utils/spaFallback.ts";
const require = createRequire(
  new URL("../backend/package.json", import.meta.url),
);
const express = require("express");
const app = express();
// Mirror the existing production CSP (with an even narrower same-origin connect
// policy) for static-only browser QA. This does not configure a live deployment.
app.use(
  require("helmet")({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: false,
  }),
);
const folder = fileURLToPath(new URL("../frontend/dist/", import.meta.url));
app.use((_req, res, next) => {
  res.setHeader("X-App-Version", "unknown");
  next();
});
app.use("/api", (_req, res) =>
  res.status(401).json({ error: "Static local preview; no application data." }),
);
app.use(express.static(folder));
registerSpaFallback(app, folder);
const server = app.listen(5188, "127.0.0.1", () =>
  console.log(
    "Disposable same-origin static preview: http://127.0.0.1:5188/docs",
  ),
);
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
