import readline from "readline/promises";
import fs from "fs";
import path from "path";
import { getApproval } from "./approval.js";
import {
  generateCDKCode,
  REPAIR_SYSTEM_PROMPT,
  REPAIR_TOOLS,
} from "./cdk-generator.js";
import {
  runDeploy,
  getRecentStackFailureEvents,
  generateReadme,
  tail,
} from "./deployer.js";
import { classifyPatch } from "./cdk-tools.js";

const MAX_REPAIR_ATTEMPTS = 3;
const LOG_TAIL_BYTES = 4000;

export async function runIaCPipeline(finalState, cdkOutputDir, apiKey) {
  // ---------------------------------------------------------------------------
  // PHASE 2: Review & Approval
  // ---------------------------------------------------------------------------
  console.log("\n📍 PHASE 2: Review & Approval\n");
  const approved = await getApproval(finalState);
  if (!approved) {
    console.log("\n⏸️  Process stopped. You can:");
    console.log(`   - Re-open the diagram: diagram`);
    console.log(`   - Re-run with a different prompt\n`);
    return false;
  }

  // ---------------------------------------------------------------------------
  // PHASE 3: CDK Code Generation (returns a live agent we keep around)
  // ---------------------------------------------------------------------------
  console.log("\n📍 PHASE 3: CDK Code Generation\n");
  let agent;
  let generatedFiles;
  try {
    const out = await generateCDKCode(finalState, cdkOutputDir, apiKey);
    agent = out.agent;
    generatedFiles = out.generatedFiles;
  } catch (error) {
    console.error("\n❌ CDK code generation failed!");
    console.error(error.message);
    return false;
  }
  console.log(`\n✅ Generated ${generatedFiles.length} CDK files:`);
  for (const file of generatedFiles) console.log(`   - ${file}`);
  generateReadme(cdkOutputDir, finalState.metadata);
  console.log(`   - README.md`);
  console.log(`\n📁 CDK project location: ${cdkOutputDir}`);

  // ---------------------------------------------------------------------------
  // PHASE 4: Deployment (and PHASE 5 inline auto-repair)
  // ---------------------------------------------------------------------------
  console.log("\n📍 PHASE 4: Deployment\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const goDeploy = await rl.question("Deploy to AWS now? (yes/no): ");
  if (!/^y(es)?$/i.test(goDeploy.trim())) {
    rl.close();
    console.log("\n⏸️  Skipping deployment.");
    console.log(`\nTo deploy later:`);
    console.log(`  cd ${cdkOutputDir}`);
    console.log(`  npm install && npm run build`);
    console.log(`  cdk deploy`);
    console.log(`\nTo tear down after a deploy, from repo root: infra-decommission\n`);
    return true;
  }

  const bootstrapAns = await rl.question(
    "\n🔧 Bootstrap CDK environment (required for first deployment)? (yes/no): "
  );
  const bootstrap = /^y(es)?$/i.test(bootstrapAns.trim());

  let attempt = 0;
  let result = await runDeploy(cdkOutputDir, finalState.metadata, {
    bootstrap,
    skipDiff: false,
  });

  let lastFailureSignature = null;
  let lastUserDecision = null;

  while (!result.ok && attempt < MAX_REPAIR_ATTEMPTS) {
    attempt++;
    console.log("\n" + "=".repeat(80));
    console.log(`📍 PHASE 5: Auto-Repair (attempt ${attempt}/${MAX_REPAIR_ATTEMPTS})`);
    console.log("=".repeat(80));

    // No-progress detector: same phase + same first error line twice in a row.
    const sig = `${result.phase}::${firstErrorLine(result.stderr || result.stdout || "")}`;
    if (lastFailureSignature && sig === lastFailureSignature) {
      console.log("\n⚠️  Same failure signature as last attempt — auto-repair stopping to avoid a loop.");
      break;
    }
    lastFailureSignature = sig;

    const context = await buildFailureContext(
      result,
      finalState.metadata,
      attempt,
      lastUserDecision
    );

    agent.ctx.mode = "repair";
    agent.pushUserMessage(context);

    console.log(`\n🩺 Asking the same agent to diagnose and patch...`);
    const turn = await agent.runUntilStop({
      system: REPAIR_SYSTEM_PROMPT,
      tools: REPAIR_TOOLS,
      maxIterations: 10,
    });
    persistSession(cdkOutputDir, agent, attempt, result);

    if (!turn.proposedPatch) {
      console.log(
        `⚠️  Agent did not propose a patch (stopReason: ${turn.stopReason}). Stopping auto-repair.`
      );
      break;
    }

    const decision = await reviewAndApply(turn.proposedPatch, cdkOutputDir, agent, rl);
    lastUserDecision = decision.outcome;

    if (decision.outcome === "abort") {
      console.log("\n⏸️  Auto-repair aborted by user.");
      break;
    }
    if (decision.outcome === "no-fix") {
      console.log("\n⚠️  No acceptable fix proposed. Stopping auto-repair.");
      break;
    }

    agent.pushUserMessage(
      "Patch applied. Redeploying now. If the next deploy fails, I will send you the new failure context."
    );

    console.log("\n🔁 Redeploying with the patched files...");
    result = await runDeploy(cdkOutputDir, finalState.metadata, {
      bootstrap: false,
      skipDiff: true,
    });
  }

  rl.close();

  if (result.ok) {
    if (attempt > 0) {
      console.log(
        `\n🎉 Auto-repair succeeded after ${attempt} attempt${attempt === 1 ? "" : "s"}!`
      );
    }
    console.log("\n" + "=".repeat(80));
    console.log("🎉 SUCCESS! Your infrastructure is now live on AWS!");
    console.log("=".repeat(80));
    console.log(`\nCDK Project: ${cdkOutputDir}`);
    console.log("\nTo manage your infrastructure:");
    console.log(`  cd ${cdkOutputDir}`);
    console.log(`  cdk diff     # See changes`);
    console.log(`  cdk deploy   # Deploy updates`);
    console.log("\nTo remove everything from AWS later (from this repo root):");
    console.log(`  infra-decommission`);
    console.log(`  # same as: cd ${cdkOutputDir} && npx cdk destroy --all --force\n`);
    return true;
  }

  console.log("\n⚠️  Deployment did not complete after auto-repair.");
  console.log(`   Last failure phase: ${result.phase}`);
  if (result.transcriptPath) console.log(`   Transcript:         ${result.transcriptPath}`);
  console.log(`\nYou can investigate and re-run manually:`);
  console.log(`  cd ${cdkOutputDir}`);
  console.log(`  npm install && npm run build && cdk deploy\n`);
  return false;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Show the proposed patch, gate by SAFE/RISKY, optionally prompt the user,
 * and apply files to disk if accepted.
 *
 * @returns {Promise<{outcome: "applied"|"no-fix"|"abort"}>}
 */
async function reviewAndApply(patch, cdkOutputDir, agent, rl) {
  const risk = classifyPatch(patch.files);
  console.log(`\n🩺 Proposed patch: ${patch.summary || "(no summary)"}`);
  if (patch.rationale) console.log(`   Rationale: ${patch.rationale}`);
  console.log(`   Risk:      ${risk}`);
  console.log(`   Files:`);
  for (const f of patch.files || []) {
    console.log(`     - ${f.path}${f.reason ? `  (${f.reason})` : ""}`);
  }

  if (risk === "RISKY") {
    const ans = await rl.question(
      "\nApply this RISKY patch? (yes / no = ask agent for safer fix / abort): "
    );
    const a = ans.trim().toLowerCase();
    if (/^a(bort)?$/.test(a)) return { outcome: "abort" };
    if (!/^y(es)?$/.test(a)) {
      console.log("⏸️  Asking agent for a safer alternative...");
      agent.pushUserMessage(
        "The user rejected the previous patch because it was classified RISKY (touches IAM, security group ingress, or RemovalPolicy.RETAIN). Propose a different fix that does NOT touch any of those areas. Reply ONLY with a propose_patch call."
      );
      const retry = await agent.runUntilStop({
        system: REPAIR_SYSTEM_PROMPT,
        tools: REPAIR_TOOLS,
        maxIterations: 6,
      });
      if (!retry.proposedPatch) return { outcome: "no-fix" };
      const retryRisk = classifyPatch(retry.proposedPatch.files);
      if (retryRisk === "RISKY") {
        console.log("⚠️  Agent's alternate patch is still RISKY. Stopping auto-repair.");
        return { outcome: "no-fix" };
      }
      console.log(`\n🩺 Alternate patch: ${retry.proposedPatch.summary || "(no summary)"}`);
      console.log(`   Risk:      ${retryRisk}`);
      applyPatchFiles(retry.proposedPatch, cdkOutputDir);
      console.log("   ✓ SAFE alternate patch auto-applied.");
      return { outcome: "applied" };
    }
    applyPatchFiles(patch, cdkOutputDir);
    console.log("   ✓ RISKY patch applied with user approval.");
    return { outcome: "applied" };
  }

  console.log("   ✓ SAFE — auto-applying");
  applyPatchFiles(patch, cdkOutputDir);
  return { outcome: "applied" };
}

async function buildFailureContext(result, metadata, attempt, lastUserDecision) {
  const stackName = (metadata && metadata.stackName) || "Unknown";
  const combinedLog = `${result.stdout || ""}\n${result.stderr || ""}`;
  const logTail = tail(combinedLog, LOG_TAIL_BYTES) || "(empty)";

  let cfnEvents = "";
  if (result.phase === "deploy") {
    try {
      cfnEvents = await getRecentStackFailureEvents(stackName, 30);
    } catch (e) {
      cfnEvents = `(could not fetch CFN events: ${e.message})`;
    }
  }

  const lines = [
    `# Deploy failure — auto-repair attempt ${attempt}`,
    "",
    `Phase that failed: **${result.phase}**`,
    `Command:           \`${result.command || "n/a"}\``,
    `Exit code:         ${result.exitCode == null ? "n/a" : result.exitCode}`,
    `Stack:             ${stackName}`,
    `Region:            ${metadata && metadata.region ? metadata.region : "(default)"}`,
  ];
  if (lastUserDecision) {
    lines.push(`Previous user decision: ${lastUserDecision}`);
  }
  lines.push(
    "",
    "## Last 4 KB of stdout/stderr",
    "```",
    logTail,
    "```"
  );
  if (cfnEvents) {
    lines.push("", "## CloudFormation failed events (most recent first)", "```json", cfnEvents, "```");
  }
  lines.push(
    "",
    "Use `read_file` to inspect any source file before patching it.",
    "Then call `propose_patch` ONCE with the smallest viable fix. Provide complete new file content.",
    "Mark the patch as `riskLevel: \"risky\"` if it touches IAM, security group ingress, or RemovalPolicy.RETAIN."
  );
  return lines.join("\n");
}

function firstErrorLine(text) {
  if (!text) return "";
  const m = text.match(/(error|failed|invalid|unable)[^\n]{0,200}/i);
  if (m) return m[0].trim();
  return text.split("\n")[0]?.slice(0, 200) || "";
}

function applyPatchFiles(patch, outputDir) {
  const baseAbs = path.resolve(outputDir);
  for (const file of patch.files || []) {
    if (!file || !file.path) continue;
    const target = path.resolve(outputDir, file.path);
    if (target !== baseAbs && !target.startsWith(baseAbs + path.sep)) {
      throw new Error(`Patch path escapes project directory: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.newContent ?? "", "utf8");
    console.log(`     ✎ ${file.path} (${(file.newContent || "").length} bytes)`);
  }
}

/**
 * Persist a redacted snapshot of the agent session next to the CDK project so
 * the auto-repair process is debuggable after the fact.
 */
function persistSession(cdkOutputDir, agent, attempt, lastResult) {
  try {
    const dir = path.join(cdkOutputDir, ".infra-agent");
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `agent-session.json`);
    const cap = (s) =>
      typeof s === "string" ? s.slice(0, 4000) : JSON.stringify(s).slice(0, 4000);
    const summary = {
      updatedAt: new Date().toISOString(),
      attempt,
      mode: agent.ctx.mode,
      generatedFiles: agent.ctx.generatedFiles,
      lastResult: lastResult
        ? {
            ok: lastResult.ok,
            phase: lastResult.phase,
            command: lastResult.command,
            exitCode: lastResult.exitCode,
            transcriptPath: lastResult.transcriptPath,
          }
        : null,
      proposedPatch: agent.ctx.proposedPatch
        ? {
            summary: agent.ctx.proposedPatch.summary,
            rationale: agent.ctx.proposedPatch.rationale,
            files: (agent.ctx.proposedPatch.files || []).map((f) => ({
              path: f.path,
              riskLevel: f.riskLevel,
              reason: f.reason,
              newContentBytes: (f.newContent || "").length,
            })),
          }
        : null,
      messages: agent.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? cap(m.content)
            : Array.isArray(m.content)
            ? m.content.map((b) => {
                if (b.type === "text") return { type: "text", text: cap(b.text || "") };
                if (b.type === "tool_use")
                  return { type: "tool_use", name: b.name, input: b.input };
                if (b.type === "tool_result")
                  return {
                    type: "tool_result",
                    tool_use_id: b.tool_use_id,
                    content: cap(b.content),
                    is_error: !!b.is_error,
                  };
                return { type: b.type };
              })
            : "",
      })),
    };
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  } catch {
    // best-effort only; never fail the pipeline because of session persistence
  }
}
