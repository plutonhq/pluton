import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import Docs, { docsLoader } from "./App.tsx";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/docs/*",
    element: <Docs />,
    loader: docsLoader,
    errorElement: (
      <main className="mx-auto max-w-2xl p-8">
        <h1>Dokumentasi tidak dapat dimuat</h1>
        <p>Muat ulang build lokal atau kembali ke aplikasi.</p>
        <a href="/docs">Documentation</a> · <a href="/">Pluton</a>
      </main>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
