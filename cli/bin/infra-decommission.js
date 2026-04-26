#!/usr/bin/env node
/**
 * Tear down all stacks for an InfraAgent CDK app under ./cdk-infrastructure.
 *
 * Usage:
 *   infra-decommission              # uses process.cwd()
 *   infra-decommission /path/to/repo   # parent of cdk-infrastructure/
 */
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { runDecommission } from "../src/deployer.js";

const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const cdkDir = path.join(cwd, "cdk-infrastructure");
const statePath = path.join(cwd, "infra-diagram.state.json");

if (!fs.existsSync(cdkDir)) {
  console.error(`No cdk-infrastructure directory at:\n  ${cdkDir}`);
  console.error("\nRun this from the project root that contains cdk-infrastructure/, or pass that path as the first argument.");
  process.exit(1);
}
if (!fs.existsSync(path.join(cdkDir, "package.json"))) {
  console.error(`${cdkDir} does not look like a CDK project (missing package.json).`);
  process.exit(1);
}

let metadata = { stackName: "", region: "", environment: "dev", name: "" };
if (fs.existsSync(statePath)) {
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (st.metadata) metadata = { ...metadata, ...st.metadata };
  } catch {
    // ignore
  }
}

console.log("╔" + "═".repeat(76) + "╗");
console.log("║  DECOMMISSION — permanently delete AWS resources for this CDK app        ║");
console.log("╚" + "═".repeat(76) + "╝\n");

console.log("This will run:  npx cdk destroy --all --force");
console.log(`CDK directory:    ${cdkDir}`);
if (metadata.stackName) console.log(`Diagram metadata stackName: ${metadata.stackName}`);
if (metadata.region) console.log(`Region (AWS_DEFAULT_REGION): ${metadata.region}`);
console.log(
  "\nStacks with RemovalPolicy.RETAIN or protected data may leave buckets, logs, or snapshots — check the AWS console after destroy.\n"
);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const typed = (
  await rl.question("Type DECOMMIT in all caps to continue (anything else cancels): ")
).trim();
rl.close();

if (typed !== "DECOMMIT") {
  console.log("\n⏸️  Cancelled.");
  process.exit(0);
}

const result = await runDecommission(cdkDir, metadata);
if (!result.ok) {
  console.error(`\n❌ Decommission failed at phase: ${result.phase}`);
  if (result.command) console.error(`   Command: ${result.command}`);
  if (result.transcriptPath) console.error(`   Log:     ${result.transcriptPath}`);
  process.exit(1);
}
if (result.transcriptPath) console.log(`\n📄 Transcript: ${result.transcriptPath}`);
process.exit(0);
