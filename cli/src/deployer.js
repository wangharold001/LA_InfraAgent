import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { tail } from "./tf-tools.js";

export { tail };

// =============================================================================
// Internal helpers
// =============================================================================

function spawnAndTee(cmd, args, opts = {}, transcriptStream = null) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["inherit", "pipe", "pipe"], ...opts });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { const s = d.toString(); stdout += s; process.stdout.write(s); if (transcriptStream) transcriptStream.write(s); });
    child.stderr.on("data", (d) => { const s = d.toString(); stderr += s; process.stderr.write(s); if (transcriptStream) transcriptStream.write(s); });
    child.on("error", (e) => resolve({ exitCode: -1, error: e.message, stdout, stderr }));
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

function preflight(tfDir) {
  console.log("\n🔍 Checking Terraform CLI...");
  try {
    const ver = execSync("terraform version -json", { encoding: "utf8" });
    const parsed = JSON.parse(ver);
    console.log(`   ✓ Found: Terraform ${parsed.terraform_version}`);
  } catch {
    return { ok: false, phase: "preflight", error: "Terraform CLI not installed. See https://developer.hashicorp.com/terraform/install" };
  }
  return { ok: true };
}

function openTranscript(tfDir, kind = "apply") {
  const dir = path.join(tfDir, ".infra-agent");
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `${kind}-${Date.now()}.log`);
  const stream = fs.createWriteStream(transcriptPath, { flags: "a" });
  stream.write(`# infra-agent terraform ${kind} transcript\n# started: ${new Date().toISOString()}\n\n`);
  return { stream, transcriptPath };
}

// =============================================================================
// runDeploy — terraform init → plan → apply
// =============================================================================

export async function runDeploy(tfDir, metadata = {}, opts = {}) {
  const { skipPlan = false } = opts;

  console.log("\n" + "=".repeat(80));
  console.log("🚀 Terraform Deploy");
  console.log("=".repeat(80));

  const pre = preflight(tfDir);
  if (!pre.ok) { console.error(`\n❌ ${pre.error}`); return pre; }

  const { stream: transcript, transcriptPath } = openTranscript(tfDir, "apply");
  const env = { ...process.env };
  if (metadata.region) env.AWS_DEFAULT_REGION = metadata.region;

  const steps = [
    { phase: "init",  label: "📦 Initializing Terraform...", cmd: "terraform", args: ["init", "-input=false"] },
    ...(!skipPlan ? [{ phase: "plan", label: "📋 Generating plan...", cmd: "terraform", args: ["plan", "-out=tfplan", "-input=false"], successExitCodes: [0, 2] }] : []),
    { phase: "apply", label: "🚀 Applying changes (this may take several minutes)...", cmd: "terraform", args: ["apply", "-auto-approve", "-input=false", ...(skipPlan ? [] : ["tfplan"])] },
  ];

  for (const step of steps) {
    console.log(`\n${step.label}`);
    transcript.write(`\n\n## ${step.phase}: ${step.cmd} ${step.args.join(" ")}\n\n`);
    const res = await spawnAndTee(step.cmd, step.args, { cwd: tfDir, env }, transcript);
    const ok = (step.successExitCodes || [0]).includes(res.exitCode);
    if (!ok) {
      transcript.end();
      return { ok: false, phase: step.phase, command: `${step.cmd} ${step.args.join(" ")}`, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, transcriptPath, error: res.error };
    }
    console.log(`   ✓ ${step.phase} completed`);
  }

  // Capture outputs
  let outputs = "";
  try {
    outputs = execSync("terraform output -json", { cwd: tfDir, encoding: "utf8" });
    const parsed = JSON.parse(outputs);
    if (Object.keys(parsed).length) {
      console.log("\n📤 Outputs:");
      for (const [k, v] of Object.entries(parsed)) {
        console.log(`   ${k} = ${v.sensitive ? "(sensitive)" : JSON.stringify(v.value)}`);
      }
    }
  } catch { /* outputs optional */ }

  transcript.write(`\n\n# completed: ${new Date().toISOString()}\n`);
  transcript.end();
  return { ok: true, phase: "complete", transcriptPath, outputs };
}

// =============================================================================
// runDecommission — terraform destroy
// =============================================================================

export async function runDecommission(tfDir, metadata = {}) {
  console.log("\n" + "=".repeat(80));
  console.log("🧨 Terraform Destroy (removing all managed resources)");
  console.log("=".repeat(80));

  const pre = preflight(tfDir);
  if (!pre.ok) { console.error(`\n❌ ${pre.error}`); return pre; }

  const { stream: transcript, transcriptPath } = openTranscript(tfDir, "destroy");
  const env = { ...process.env };
  if (metadata.region) env.AWS_DEFAULT_REGION = metadata.region;

  const steps = [
    { phase: "init",    label: "📦 Initializing Terraform...", cmd: "terraform", args: ["init", "-input=false"] },
    { phase: "destroy", label: "🧨 Destroying all resources (this may take several minutes)...", cmd: "terraform", args: ["destroy", "-auto-approve", "-input=false"] },
  ];

  for (const step of steps) {
    console.log(`\n${step.label}`);
    transcript.write(`\n\n## ${step.phase}: ${step.cmd} ${step.args.join(" ")}\n\n`);
    const res = await spawnAndTee(step.cmd, step.args, { cwd: tfDir, env }, transcript);
    if (res.exitCode !== 0) {
      transcript.end();
      return { ok: false, phase: step.phase, command: `${step.cmd} ${step.args.join(" ")}`, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr, transcriptPath, error: res.error };
    }
    console.log(`   ✓ ${step.phase} completed`);
  }

  console.log("\n✅ Destroy completed — resources removed (subject to deletion protection).");
  transcript.write(`\n\n# completed: ${new Date().toISOString()}\n`);
  transcript.end();
  return { ok: true, phase: "complete", transcriptPath };
}
