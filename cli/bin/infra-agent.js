#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { readRepo } from "../src/reader.js";
import { runAgent } from "../src/agent.js";
import { writeAndOpen } from "../src/renderer.js";
import { waitForBrowserApproval } from "../src/browser-approval.js";
import { generateCDKCode } from "../src/cdk-generator.js";

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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const userPrompt = (await rl.question('What infrastructure would you like to build? ')).trim()
  || "diagram my current directory";
rl.close();

let repoContext = "";
if (fs.existsSync(repoRoot)) {
  process.stdout.write("📂 Reading repository context... ");
  repoContext = readRepo(repoRoot);
  console.log(repoContext ? "done." : "no source files found, proceeding without repo context.");
}

console.log("🤖 Generating architecture with Claude AI...\n");

let state = await runAgent(repoContext, userPrompt, apiKey, {
  onTool: (name, input) => {
    if (name === "add_node") console.log(`  + node  ${input.type.padEnd(12)} ${input.label || ""}`);
    if (name === "add_edge") console.log(`  + edge  ${input.from_id} → ${input.to_id}${input.label ? ` (${input.label})` : ""}`);
    if (name === "set_metadata") console.log(`  * stack ${input.stackName || input.name}`);
  },
});

console.log(`\n✅ Architecture generated: ${state.nodes.length} resources, ${state.edges.length} connections`);

// ============================================================================
// PHASE 2: Browser-Based Review & Approval
// ============================================================================
console.log("\n📍 PHASE 2: Review & Approval\n");

// Define approval file path
const approvalFilePath = path.join(repoRoot, ".infra-agent-approved.json");

// Save diagram with approval UI
const diagramPath = writeAndOpen(state, outputPath, {
  approvalMode: true,
  approvalFileName: ".infra-agent-approved.json"
});

console.log(`📊 Diagram opened in browser: ${diagramPath}`);

// Wait for user to approve in browser
let approvedState;
try {
  approvedState = await waitForBrowserApproval(approvalFilePath);
} catch (error) {
  console.error("\n❌ Approval cancelled or timed out.");
  console.log("\n⏸️  Process stopped. You can:");
  console.log(`   - Reopen the diagram: ${diagramPath}`);
  console.log(`   - Edit it manually in the browser`);
  console.log(`   - Re-run this tool with a different prompt\n`);
  process.exit(1);
}

// Use approved state (which may have user edits!)
state = approvedState;

// ============================================================================
// PHASE 3: CDK Code Generation
// ============================================================================
console.log("\n📍 PHASE 3: CDK Code Generation\n");

try {
  const generatedFiles = await generateCDKCode(state, cdkOutputDir, apiKey);

  console.log(`\n✅ Generated ${generatedFiles.length} CDK files:`);
  for (const file of generatedFiles) {
    console.log(`   - ${file}`);
  }

  console.log(`\n📁 CDK project location: ${cdkOutputDir}`);
} catch (error) {
  console.error("\n❌ CDK code generation failed!");
  console.error(error.message);
  process.exit(1);
}

console.log("\n" + "=".repeat(80));
console.log("🎉 SUCCESS! Your CDK code has been generated!");
console.log("=".repeat(80));
console.log(`\nNext steps:`);
console.log(`  cd ${cdkOutputDir}`);
console.log(`  npm install           # Install dependencies`);
console.log(`  npm run build         # Compile TypeScript`);
console.log(`  npx cdk bootstrap     # Bootstrap CDK (first time only)`);
console.log(`  npx cdk deploy        # Deploy to AWS\n`);
