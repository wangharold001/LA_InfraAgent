import http from "http";
import fs from "fs";

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
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        } catch (e) {
          res.writeHead(500); res.end("Could not read diagram file");
        }
        return;
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
