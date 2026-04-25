#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { readRepo } from "../src/reader.js";
import { runAgent, MODE_PROMPTS } from "../src/agent.js";
import { writeAndOpen } from "../src/renderer.js";
import { runIaCPipeline } from "../src/iac-pipeline.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const outputPath = path.join(repoRoot, "infra-diagram.html");
const cdkOutputDir = path.join(repoRoot, "cdk-infrastructure");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

console.log("╔════════════════════════════════════════════════════════════════════════╗");
console.log("║                   🏗️  InfraAgent - AWS Solutions Architect             ║");
console.log("║                   From Prompt → Architecture → CDK → Deploy           ║");
console.log("╚════════════════════════════════════════════════════════════════════════╝\n");

// ============================================================================
// PHASE 1: Prompt → Architecture Design
// ============================================================================
console.log("📍 PHASE 1: Architecture Design\n");

const MODES = Object.keys(MODE_PROMPTS);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const userPrompt = (await rl.question('What infrastructure would you like to build? ')).trim()
  || "diagram my current directory";

console.log(`\nGeneration modes: ${MODES.map((m, i) => `[${i + 1}] ${m}`).join("  ")}`);
const modeAnswer = (await rl.question("Choose mode (default: simple): ")).trim();
const modeIndex = parseInt(modeAnswer, 10) - 1;
const mode = (modeIndex >= 0 && modeIndex < MODES.length) ? MODES[modeIndex]
  : MODES.includes(modeAnswer) ? modeAnswer
  : "simple";
rl.close();

let repoContext = "";
if (fs.existsSync(repoRoot)) {
  process.stdout.write("📂 Reading repository context... ");
  repoContext = readRepo(repoRoot);
  console.log(repoContext ? "done." : "no source files found, proceeding without repo context.");
}

console.log(`🤖 Generating architecture with Claude AI (mode: ${mode})...\n`);

const state = await runAgent(repoContext, userPrompt, apiKey, {
  mode,
  onTool: (name, input) => {
    if (name === "add_node") console.log(`  + node  ${input.type.padEnd(12)} ${input.label || ""}`);
    if (name === "add_edge") console.log(`  + edge  ${input.from_id} → ${input.to_id}${input.label ? ` (${input.label})` : ""}`);
    if (name === "set_metadata") console.log(`  * stack ${input.stackName || input.name}`);
  },
});

console.log(`\n✅ Architecture generated: ${state.nodes.length} resources, ${state.edges.length} connections`);

// Save diagram + open browser via local server
const { outputPath: diagramPath, stateJsonPath, port, closeServer } = await writeAndOpen(state, outputPath);
console.log(`📊 Diagram opened: http://127.0.0.1:${port}`);
console.log(`📄 State file:     ${stateJsonPath}`);

// ── Wait for user to finish editing in the browser ──────────────────────────
console.log("\n🖊️  Edit the diagram in your browser.");
console.log("   Changes save automatically. Press Enter here when ready.\n");

const rlEdit = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlEdit.question("Press Enter when your diagram is ready...");
rlEdit.close();
closeServer();

// Read updated state from the JSON file if the user saved changes
let finalState = state;
if (fs.existsSync(stateJsonPath)) {
  try {
    const updated = JSON.parse(fs.readFileSync(stateJsonPath, "utf8"));
    if (Array.isArray(updated.nodes) && Array.isArray(updated.edges)) {
      finalState = updated;
      console.log(`\n✅ Loaded updated diagram: ${finalState.nodes.length} resources, ${finalState.edges.length} connections`);
    }
  } catch {
    console.log("⚠️  Could not parse state file — using original generated diagram.");
  }
} else {
  console.log("ℹ️  No saved state file found — using original generated diagram.");
}

await runIaCPipeline(finalState, cdkOutputDir, apiKey);
