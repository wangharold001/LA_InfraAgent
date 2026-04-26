#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { writeAndOpen } from "../src/renderer.js";
import { runIaCPipeline } from "../src/iac-pipeline.js";
import { readRepo } from "../src/reader.js";

const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const htmlPath     = path.join(cwd, "infra-diagram.html");
const stateJsonPath = path.join(cwd, "infra-diagram.state.json");
const cdkOutputDir  = path.join(cwd, "terraform-infrastructure");

if (!fs.existsSync(htmlPath)) {
  console.error(`No infra-diagram.html found in ${cwd}`);
  console.error("Run infra-agent first to generate one.");
  process.exit(1);
}

// Load existing state so the browser shows the current diagram.
// Falls back to empty state if no state file exists yet.
let initialState = {
  schemaVersion: "0.2.0",
  metadata: { name: "Untitled", stackName: "", region: "us-east-1", account: "", environment: "dev", createdAt: new Date().toISOString() },
  nodes: [],
  edges: []
};
if (fs.existsSync(stateJsonPath)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) initialState = parsed;
  } catch {}
}

// Re-inject current state + live server port into the HTML so auto-save works.
process.stdout.write("📂 Reading repository context... ");
const repoContext = readRepo(cwd);
console.log(repoContext ? "done." : "no source files found.");

const { port, closeServer } = await writeAndOpen(initialState, htmlPath, repoContext);

console.log(`\nDiagram open at http://127.0.0.1:${port}`);
console.log("Edit it in the browser. Changes save automatically.");
console.log("\nPress Enter to generate IaC from this diagram, or Ctrl+C to exit.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter when your diagram is ready...");
rl.close();
closeServer();

// Read the state the browser last saved
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
