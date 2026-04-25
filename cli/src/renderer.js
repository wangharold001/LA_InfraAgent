import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { startServer } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../assets/diagram-editor.html");

export async function writeAndOpen(state, outputPath) {
  const stateJsonPath = outputPath.replace(/\.html$/, ".state.json");

  // Write initial state JSON so the CLI can read it back after browser edits
  fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2), "utf8");

  // Start local server — browser POSTs state changes to /state
  const { server, port } = await startServer(outputPath, stateJsonPath);

  // Inject state, file path hint, and server port into the HTML
  const html = fs.readFileSync(TEMPLATE, "utf8");
  const injected = html
    .replace("let state = freshState();",
      `let state = ${JSON.stringify(state, null, 2)};`)
    .replace("const __STATE_JSON_PATH__ = null;",
      `const __STATE_JSON_PATH__ = ${JSON.stringify(stateJsonPath)};`)
    .replace("const __SERVER_PORT__ = null;",
      `const __SERVER_PORT__ = ${port};`);

  fs.writeFileSync(outputPath, injected, "utf8");

  // Open browser to localhost (File System Access API works on localhost)
  const url = `http://127.0.0.1:${port}`;
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "start" :
    "xdg-open";
  try { execSync(`${opener} "${url}"`, { stdio: "ignore" }); } catch {}

  return { outputPath, stateJsonPath, port, closeServer: () => server.close() };
}
