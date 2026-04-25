#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { execSync } from "child_process";
import { startServer } from "../src/server.js";
import { runIaCPipeline } from "../src/iac-pipeline.js";

const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const htmlPath      = path.join(cwd, "infra-diagram.html");
const stateJsonPath = path.join(cwd, "infra-diagram.state.json");
const cdkOutputDir  = path.join(cwd, "cdk-infrastructure");

if (!fs.existsSync(htmlPath)) {
  console.error(`No infra-diagram.html found in ${cwd}`);
  console.error("Run infra-agent first to generate one.");
  process.exit(1);
}

const { server, port } = await startServer(htmlPath, stateJsonPath);
const url = `http://127.0.0.1:${port}`;

const opener =
  process.platform === "darwin" ? "open" :
  process.platform === "win32"  ? "start" :
  "xdg-open";
try { execSync(`${opener} "${url}"`, { stdio: "ignore" }); } catch {}

console.log(`\nDiagram open at ${url}`);
console.log("Edit it in the browser. Changes save automatically.");
console.log("\nPress Enter to generate IaC from this diagram, or Ctrl+C to exit.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter when your diagram is ready...");
rl.close();
server.close();

// Load latest saved state
let finalState = null;
if (fs.existsSync(stateJsonPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      finalState = parsed;
      console.log(`\n✅ Loaded diagram: ${finalState.nodes.length} resources, ${finalState.edges.length} connections`);
    }
  } catch {
    console.error("⚠️  Could not parse state file.");
  }
}

if (!finalState) {
  console.error("No valid diagram state found. Open the diagram and make sure it's saved.");
  process.exit(1);
}

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

await runIaCPipeline(finalState, cdkOutputDir, apiKey);
process.exit(0);
