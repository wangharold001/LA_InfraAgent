import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../assets/diagram-editor.html");

export function writeAndOpen(state, outputPath) {
  const html = fs.readFileSync(TEMPLATE, "utf8");

  // Write state as a standalone JSON file the CDK agent can read directly
  const stateJsonPath = outputPath.replace(/\.html$/, ".state.json");
  fs.writeFileSync(stateJsonPath, JSON.stringify(state, null, 2), "utf8");

  // Inject state and the JSON file path so the browser can auto-save back to it
  const injected = html
    .replace(
      "let state = freshState();",
      `let state = ${JSON.stringify(state, null, 2)};`
    )
    .replace(
      "const __STATE_JSON_PATH__ = null;",
      `const __STATE_JSON_PATH__ = ${JSON.stringify(stateJsonPath)};`
    );

  fs.writeFileSync(outputPath, injected, "utf8");

  // Open in the default browser
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "start" :
    "xdg-open";

  try {
    execSync(`${opener} "${outputPath}"`, { stdio: "ignore" });
  } catch {
    // Non-fatal — user can open the file manually
  }

  return outputPath;
}
