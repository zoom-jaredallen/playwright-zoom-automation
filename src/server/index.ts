import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createAutomationServer, resolveBuiltUiPath } from "./app.js";

const port = Number.parseInt(process.env.UI_PORT ?? "4174", 10);
const app = createAutomationServer();

if (process.env.UI_DEV !== "false") {
  const { createServer } = await import("vite");
  const uiRoot = path.resolve("src/ui");
  const vite = await createServer({
    root: uiRoot,
    appType: "spa",
    server: {
      middlewareMode: true
    }
  });
  app.use(vite.middlewares);
  app.use(async (request, response, next) => {
    try {
      const indexPath = path.join(uiRoot, "index.html");
      const html = await fs.readFile(indexPath, "utf8");
      response
        .status(200)
        .type("html")
        .send(await vite.transformIndexHtml(request.originalUrl, html));
    } catch (error) {
      next(error);
    }
  });
} else {
  const builtUiPath = resolveBuiltUiPath();
  app.use(express.static(builtUiPath));
  app.use((_request, response) => {
    response.sendFile(path.join(builtUiPath, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Zoom automation console listening on http://localhost:${port}`);
});
