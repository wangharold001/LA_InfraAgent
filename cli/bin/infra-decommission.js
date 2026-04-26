#!/usr/bin/env node
/**
 * Tear down all Terraform-managed resources under ./terraform-infrastructure.
 *
 * Usage:
 *   infra-decommission              # uses process.cwd()
 *   infra-decommission /path/to/repo
 */
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { runDecommission } from "../src/deployer.js";

const cwd = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const tfDir = path.join(cwd, "terraform-infrastructure");
const statePath = path.join(cwd, "infra-diagram.state.json");

if (!fs.existsSync(tfDir)) {
  console.error(`No terraform-infrastructure directory at:\n  ${tfDir}`);
  console.error("\nRun this from the project root that contains terraform-infrastructure/, or pass that path as the first argument.");
  process.exit(1);
}
if (!fs.existsSync(path.join(tfDir, "providers.tf")) && !fs.existsSync(path.join(tfDir, "main.tf"))) {
  console.error(`${tfDir} does not look like a Terraform project (missing providers.tf or main.tf).`);
  process.exit(1);
}

let metadata = { stackName: "", region: "", environment: "dev", name: "" };
if (fs.existsSync(statePath)) {
  try {
    const st = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (st.metadata) metadata = { ...metadata, ...st.metadata };
  } catch { /* ignore */ }
}

console.log("╔" + "═".repeat(76) + "╗");
console.log("║  DECOMMISSION — permanently destroy all Terraform-managed resources     ║");
console.log("╚" + "═".repeat(76) + "╝\n");

console.log("This will run:  terraform destroy -auto-approve");
console.log(`Terraform dir:  ${tfDir}`);
if (metadata.region) console.log(`AWS region:     ${metadata.region}`);
console.log(
  "\nResources with deletion protection or retain lifecycle rules may not be destroyed — check your cloud console after.\n"
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

const result = await runDecommission(tfDir, metadata);
if (!result.ok) {
  console.error(`\n❌ Decommission failed at phase: ${result.phase}`);
  if (result.command) console.error(`   Command: ${result.command}`);
  if (result.transcriptPath) console.error(`   Log:     ${result.transcriptPath}`);
  process.exit(1);
}
if (result.transcriptPath) console.log(`\n📄 Transcript: ${result.transcriptPath}`);
process.exit(0);
