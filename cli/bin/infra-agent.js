#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { readRepo } from "../src/reader.js";
import { runAgent } from "../src/agent.js";
import { writeAndOpen } from "../src/renderer.js";
import { getApproval } from "../src/approval.js";
import { generateCDKCode } from "../src/cdk-generator.js";
import { deployCDK, generateReadme } from "../src/deployer.js";

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

const state = await runAgent(repoContext, userPrompt, apiKey, {
  onTool: (name, input) => {
    if (name === "add_node") console.log(`  + node  ${input.type.padEnd(12)} ${input.label || ""}`);
    if (name === "add_edge") console.log(`  + edge  ${input.from_id} → ${input.to_id}${input.label ? ` (${input.label})` : ""}`);
    if (name === "set_metadata") console.log(`  * stack ${input.stackName || input.name}`);
  },
});

console.log(`\n✅ Architecture generated: ${state.nodes.length} resources, ${state.edges.length} connections`);

// Save diagram
const diagramPath = writeAndOpen(state, outputPath);
console.log(`📊 Diagram saved: ${diagramPath}`);

// ============================================================================
// PHASE 2: User Approval
// ============================================================================
console.log("\n📍 PHASE 2: Review & Approval\n");

const approved = await getApproval(state);

if (!approved) {
  console.log("\n⏸️  Process stopped. You can:");
  console.log(`   - Review the diagram: ${diagramPath}`);
  console.log(`   - Edit it manually in the browser`);
  console.log(`   - Re-run this tool with a different prompt\n`);
  process.exit(0);
}

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

  // Generate README
  const readmePath = generateReadme(cdkOutputDir, state.metadata);
  console.log(`   - README.md`);

  console.log(`\n📁 CDK project location: ${cdkOutputDir}`);
} catch (error) {
  console.error("\n❌ CDK code generation failed!");
  console.error(error.message);
  process.exit(1);
}

// ============================================================================
// PHASE 4: Deployment
// ============================================================================
console.log("\n📍 PHASE 4: Deployment\n");

const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
const shouldDeploy = await rl2.question('Deploy to AWS now? (yes/no): ');
rl2.close();

if (shouldDeploy.trim().toLowerCase() === "yes" || shouldDeploy.trim().toLowerCase() === "y") {
  const deployed = await deployCDK(cdkOutputDir, state.metadata);

  if (deployed) {
    console.log("\n" + "=".repeat(80));
    console.log("🎉 SUCCESS! Your infrastructure is now live on AWS!");
    console.log("=".repeat(80));
    console.log(`\nCDK Project: ${cdkOutputDir}`);
    console.log(`Diagram: ${diagramPath}`);
    console.log("\nTo manage your infrastructure:");
    console.log(`  cd ${cdkOutputDir}`);
    console.log(`  cdk diff     # See changes`);
    console.log(`  cdk deploy   # Deploy updates`);
    console.log(`  cdk destroy  # Tear down stack\n`);
  } else {
    console.log("\n⚠️  Deployment was not completed.");
    console.log(`\nYou can deploy manually later:`);
    console.log(`  cd ${cdkOutputDir}`);
    console.log(`  npm install`);
    console.log(`  npm run build`);
    console.log(`  cdk deploy\n`);
  }
} else {
  console.log("\n⏸️  Skipping deployment.");
  console.log(`\nTo deploy later:`);
  console.log(`  cd ${cdkOutputDir}`);
  console.log(`  npm install && npm run build`);
  console.log(`  cdk deploy\n`);
}
