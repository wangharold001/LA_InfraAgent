import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { injectApprovalUI } from "./browser-approval.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.resolve(__dirname, "../assets/diagram-editor.html");

/**
 * Write diagram HTML and open in browser
 * @param {object} state - Diagram state
 * @param {string} outputPath - Path to save HTML file
 * @param {object} options - Options
 * @param {boolean} options.approvalMode - Enable approval mode with UI
 * @param {string} options.approvalFileName - Filename for approval download
 * @returns {string} - Path to the created file
 */
export function writeAndOpen(state, outputPath, options = {}) {
  let html = fs.readFileSync(TEMPLATE, "utf8");

  // Inject the generated state so the diagram loads immediately
  html = html.replace(
    "let state = freshState();",
    `let state = ${JSON.stringify(state, null, 2)};`
  );

  // Inject approval UI if in approval mode
  if (options.approvalMode) {
    const approvalFileName = options.approvalFileName || ".infra-agent-approved.json";
    html = injectApprovalUI(html, approvalFileName);
  }

  fs.writeFileSync(outputPath, html, "utf8");

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
