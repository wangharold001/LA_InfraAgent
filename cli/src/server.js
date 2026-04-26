import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ASSETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
};

export function startServer(htmlPath, stateJsonPath) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

      if (req.method === "GET" && req.url === "/") {
        try {
          const html = fs.readFileSync(htmlPath, "utf8");
          res.writeHead(200, { "Content-Type": MIME[".html"] });
          res.end(html);
        } catch {
          res.writeHead(500); res.end("Could not read diagram file");
        }
        return;
      }

      // Serve static assets (CSS, JS) from assets directory
      if (req.method === "GET") {
        const ext = path.extname(req.url);
        if (MIME[ext]) {
          const assetPath = path.join(ASSETS_DIR, path.basename(req.url));
          try {
            const content = fs.readFileSync(assetPath, "utf8");
            res.writeHead(200, { "Content-Type": MIME[ext] });
            res.end(content);
          } catch {
            res.writeHead(404); res.end("Not found");
          }
          return;
        }
      }

      if (req.method === "POST" && req.url === "/state") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          try {
            JSON.parse(body); // validate before writing
            fs.writeFileSync(stateJsonPath, body, "utf8");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end('{"ok":true}');
          } catch {
            res.writeHead(400); res.end('{"error":"invalid JSON"}');
          }
        });
        return;
      }

      res.writeHead(404); res.end("Not found");
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}
