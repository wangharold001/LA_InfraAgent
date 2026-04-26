import { execSync, spawn } from "child_process";
import readline from "readline/promises";
import fs from "fs";
import path from "path";
import { getRecentStackFailureEvents, tail } from "./cdk-tools.js";

export { getRecentStackFailureEvents };

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Spawn a process and stream its stdout/stderr to the parent terminal AND
 * capture them into strings. Optionally tee to a transcript file.
 */
function spawnAndTee(cmd, args, opts = {}, transcriptStream = null) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["inherit", "pipe", "pipe"],
      ...opts,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
      if (transcriptStream) transcriptStream.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
      if (transcriptStream) transcriptStream.write(s);
    });
    child.on("error", (e) =>
      resolve({ exitCode: -1, error: e.message, stdout, stderr })
    );
    child.on("close", (code, signal) =>
      resolve({ exitCode: code, signal, stdout, stderr })
    );
  });
}

function preflight() {
  try {
    const cdkVersion = execSync("cdk --version", { encoding: "utf8" }).trim();
    console.log(`   ✓ Found: ${cdkVersion}`);
  } catch {
    return { ok: false, phase: "preflight", error: "AWS CDK CLI not installed (npm install -g aws-cdk)" };
  }
  try {
    const identity = execSync("aws sts get-caller-identity", { encoding: "utf8" });
    const j = JSON.parse(identity);
    console.log(`   ✓ Authenticated as: ${j.Arn}`);
    console.log(`   Account: ${j.Account}`);
  } catch {
    return { ok: false, phase: "preflight", error: "AWS credentials not configured (run `aws configure`)" };
  }
  return { ok: true };
}

function openTranscript(cdkDir, kind = "deploy") {
  const dir = path.join(cdkDir, ".infra-agent");
  fs.mkdirSync(dir, { recursive: true });
  const transcriptPath = path.join(dir, `${kind}-${Date.now()}.log`);
  const stream = fs.createWriteStream(transcriptPath, { flags: "a" });
  stream.write(`# infra-agent ${kind} transcript\n# started: ${new Date().toISOString()}\n\n`);
  return { stream, transcriptPath };
}

// =============================================================================
// runDeploy — non-interactive, structured-result pipeline used by the
// orchestrator (including the auto-repair loop).
// =============================================================================

/**
 * Run install → build → synth → (optional bootstrap) → diff → deploy.
 *
 * Always non-interactive. The caller (pipeline) is responsible for any user
 * prompts (deploy y/n, bootstrap y/n).
 *
 * @param {string} cdkDir
 * @param {object} metadata
 * @param {{bootstrap?: boolean, skipDiff?: boolean}} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   phase: string,
 *   command?: string,
 *   exitCode?: number,
 *   stdout?: string,
 *   stderr?: string,
 *   transcriptPath?: string,
 *   error?: string,
 *   outputs?: object,
 * }>}
 */
export async function runDeploy(cdkDir, metadata, opts = {}) {
  const { bootstrap = false, skipDiff = false } = opts;

  console.log("\n" + "=".repeat(80));
  console.log("🚀 CDK DEPLOYMENT");
  console.log("=".repeat(80));

  console.log("\n🔍 Checking CDK CLI and AWS credentials...");
  const pre = preflight();
  if (!pre.ok) {
    console.error(`\n❌ ${pre.error}`);
    return pre;
  }

  const { stream: transcript, transcriptPath } = openTranscript(cdkDir, "deploy");
  const env = { ...process.env };

  const steps = [
    { phase: "install", label: "📦 Installing dependencies...",       cmd: "npm",  args: ["install"] },
    { phase: "build",   label: "🔨 Building TypeScript...",            cmd: "npm",  args: ["run", "build"] },
    { phase: "synth",   label: "🔍 Synthesizing CloudFormation...",    cmd: "npx",  args: ["cdk", "synth"] },
  ];

  if (bootstrap) {
    const bootstrapArgs = metadata && metadata.region
      ? ["cdk", "bootstrap", `aws://unknown-account/${metadata.region}`]
      : ["cdk", "bootstrap"];
    steps.push({ phase: "bootstrap", label: "🔧 Bootstrapping CDK environment...", cmd: "npx", args: bootstrapArgs });
  }

  if (!skipDiff) {
    steps.push({
      phase: "diff",
      label: "📋 Generating deployment diff...",
      cmd: "npx",
      args: ["cdk", "diff"],
      // cdk diff returns 1 when there are differences, which is normal.
      successExitCodes: [0, 1],
    });
  }

  steps.push({
    phase: "deploy",
    label: "🚀 Deploying stack to AWS (this may take several minutes)...",
    cmd: "npx",
    args: ["cdk", "deploy", "--require-approval", "never"],
  });

  for (const step of steps) {
    console.log(`\n${step.label}`);
    transcript.write(`\n\n## ${step.phase}: ${step.cmd} ${step.args.join(" ")}\n\n`);
    const res = await spawnAndTee(step.cmd, step.args, { cwd: cdkDir, env }, transcript);
    const successCodes = step.successExitCodes || [0];
    if (!successCodes.includes(res.exitCode)) {
      transcript.end();
      return {
        ok: false,
        phase: step.phase,
        command: `${step.cmd} ${step.args.join(" ")}`,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        transcriptPath,
        error: res.error,
      };
    }
    console.log(`   ✓ ${step.phase} completed`);
  }

  console.log("\n✅ Deployment completed successfully!");

  // Best-effort outputs fetch
  let outputs;
  try {
    const json = execSync("npx cdk outputs --json", { cwd: cdkDir, encoding: "utf8" });
    outputs = JSON.parse(json);
    console.log("\n📤 Stack Outputs:");
    console.log(JSON.stringify(outputs, null, 2));
  } catch {
    console.log("\n📤 (No outputs defined)");
  }

  transcript.write(`\n\n# completed: ${new Date().toISOString()}\n`);
  transcript.end();

  return { ok: true, phase: "complete", transcriptPath, outputs };
}

// =============================================================================
// runDecommission — tear down every stack in the CDK app (non-interactive)
// =============================================================================

/**
 * Run install → build → cdk destroy --all --force.
 * Destroys all stacks defined in the app (same scope as a full deploy).
 *
 * @param {string} cdkDir
 * @param {object} [metadata]
 * @returns {Promise<{
 *   ok: boolean,
 *   phase: string,
 *   command?: string,
 *   exitCode?: number,
 *   stdout?: string,
 *   stderr?: string,
 *   transcriptPath?: string,
 *   error?: string,
 * }>}
 */
export async function runDecommission(cdkDir, metadata = {}) {
  console.log("\n" + "=".repeat(80));
  console.log("🧨 CDK DECOMMISSION (destroy all stacks in this app)");
  console.log("=".repeat(80));

  console.log("\n🔍 Checking CDK CLI and AWS credentials...");
  const pre = preflight();
  if (!pre.ok) {
    console.error(`\n❌ ${pre.error}`);
    return pre;
  }

  const { stream: transcript, transcriptPath } = openTranscript(cdkDir, "destroy");
  const env = { ...process.env };
  if (metadata.region) env.AWS_DEFAULT_REGION = metadata.region;

  const steps = [
    { phase: "install", label: "📦 Installing dependencies...", cmd: "npm", args: ["install"] },
    { phase: "build", label: "🔨 Building TypeScript...", cmd: "npm", args: ["run", "build"] },
    {
      phase: "destroy",
      label: "🧨 Destroying all stacks (this may take several minutes)...",
      cmd: "npx",
      args: ["cdk", "destroy", "--all", "--force"],
    },
  ];

  for (const step of steps) {
    console.log(`\n${step.label}`);
    transcript.write(`\n\n## ${step.phase}: ${step.cmd} ${step.args.join(" ")}\n\n`);
    const res = await spawnAndTee(step.cmd, step.args, { cwd: cdkDir, env }, transcript);
    const successCodes = step.successExitCodes || [0];
    if (!successCodes.includes(res.exitCode)) {
      transcript.end();
      return {
        ok: false,
        phase: step.phase,
        command: `${step.cmd} ${step.args.join(" ")}`,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        transcriptPath,
        error: res.error,
      };
    }
    console.log(`   ✓ ${step.phase} completed`);
  }

  console.log("\n✅ Decommission completed — stacks removed from AWS (subject to removal policies).");
  transcript.write(`\n\n# completed: ${new Date().toISOString()}\n`);
  transcript.end();

  return { ok: true, phase: "complete", transcriptPath };
}

// =============================================================================
// deployCDK — backwards-compatible interactive wrapper around runDeploy.
// =============================================================================

/**
 * Interactive deploy used by callers that want the legacy boolean flow.
 * The new pipeline calls runDeploy directly.
 */
export async function deployCDK(cdkDir, metadata) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await rl.question(
      "\n🔧 Bootstrap CDK environment (required for first deployment)? (yes/no): "
    );
    const bootstrap = /^y(es)?$/i.test(ans.trim());

    const goAns = await rl.question("\n🚀 Deploy this stack to AWS? (yes/no): ");
    if (!/^y(es)?$/i.test(goAns.trim())) {
      console.log("\n⏸️  Deployment cancelled by user");
      return false;
    }
    rl.close();

    const result = await runDeploy(cdkDir, metadata, { bootstrap });
    if (!result.ok) {
      console.error(`\n❌ Deployment failed at phase: ${result.phase}`);
      if (result.error) console.error(result.error);
      return false;
    }
    return true;
  } catch (e) {
    rl.close();
    console.error("\n❌ Deployment failed!");
    console.error(e.message);
    return false;
  }
}

// =============================================================================
// generateReadme (unchanged)
// =============================================================================

export function generateReadme(cdkDir, metadata) {
  const readmePath = path.join(cdkDir, "README.md");

  const content = `# ${metadata.name}

AWS CDK Infrastructure for ${metadata.name}

## Stack Information

- **Stack Name**: ${metadata.stackName}
- **Region**: ${metadata.region}
- **Environment**: ${metadata.environment}

## Prerequisites

1. Install AWS CDK CLI:
   \`\`\`bash
   npm install -g aws-cdk
   \`\`\`

2. Configure AWS credentials:
   \`\`\`bash
   aws configure
   \`\`\`

## Deployment

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`

2. Build the TypeScript code:
   \`\`\`bash
   npm run build
   \`\`\`

3. Bootstrap CDK (first time only):
   \`\`\`bash
   cdk bootstrap
   \`\`\`

4. Deploy the stack:
   \`\`\`bash
   cdk deploy
   \`\`\`

## Decommission (remove from AWS)

From the parent directory (where \`cdk-infrastructure/\` lives), if you installed the CLI globally:

\`\`\`bash
infra-decommission
\`\`\`

Or from this folder:

\`\`\`bash
cdk destroy --all --force
\`\`\`

Resources with \`RemovalPolicy.RETAIN\` (or similar) may leave buckets or other assets in your account until you delete them manually.

## Useful Commands

- \`npm run build\` - compile TypeScript to JavaScript
- \`npm run watch\` - watch for changes and compile
- \`cdk synth\` - synthesize CloudFormation template
- \`cdk diff\` - compare deployed stack with current state
- \`cdk deploy\` - deploy this stack to AWS
- \`cdk destroy --all --force\` - remove all stacks in this app from AWS (non-interactive)

## Architecture

This infrastructure was generated from an architecture diagram using InfraAgent.

See the original diagram: \`../infra-diagram.html\`

## Generated Files

- \`lib/\` - CDK stack definitions
- \`bin/\` - CDK app entry point
- \`cdk.out/\` - CloudFormation templates (generated)

---

Generated by [InfraAgent](https://github.com/yourusername/infra-agent)
`;

  fs.writeFileSync(readmePath, content, "utf8");
  return readmePath;
}

export { tail };
