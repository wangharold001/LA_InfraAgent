import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../assets/diagram-editor.html");

export function writeAndOpen(state, outputPath) {
  const html = fs.readFileSync(TEMPLATE, "utf8");

  // Inject the generated state so the diagram loads immediately
  const injected = html.replace(
    "let state = freshState();",
    `let state = ${JSON.stringify(state, null, 2)};`
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
