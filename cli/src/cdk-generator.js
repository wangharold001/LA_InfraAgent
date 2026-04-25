import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import {
  GENERATION_TOOLS,
  REPAIR_TOOLS,
  dispatchTool,
  fixInvalidJSON,
} from "./cdk-tools.js";

// =============================================================================
// System prompts
// =============================================================================

export const SYSTEM_PROMPT = `You are an expert AWS CDK developer. You have access to AWS and CDK reference material through the **aws_kb_retrieve** tool (documentation aligned with the AWS knowledge base; optional live AWS MCP server: set AWS_MCP_ENABLED per project docs). You receive an architecture diagram in JSON with CDK metadata and must output a complete, production-ready CDK TypeScript project.

AVAILABLE TOOLS:
1. **aws_kb_retrieve** — Query AWS documentation, CDK construct APIs, integration patterns, and best practices. Use it before writing complex constructs to verify prop names, types, and methods.
2. **write_file** — Write a file in the generated CDK project

WORKFLOW:
- Before each major file or non-trivial construct, call **aws_kb_retrieve** with a specific query (e.g. "aws-cdk-lib lambda.Function TypeScript", "CDK API Gateway HttpApi Lambda integration", "DynamoDB TableV2 CDK props").
- Then use **write_file** for the six project files below.

CRITICAL RULES FOR JSON FILES:
- **NEVER** include comments in JSON files (package.json, tsconfig.json, cdk.json)
- JSON does not support comments; no // or /* */; no trailing commas
- Use **write_file** with valid JSON only for those paths

CRITICAL RULES FOR RESOURCE NAMING:
- **ADD UNIQUE SUFFIXES** to physical resource names to avoid "already exists" errors
- Use \`\${Stack.of(this).stackName}\` in names where appropriate (SNS, SQS, S3, Lambda, etc.)
- For SNS, SQS, S3, always use stack-scoped unique identifiers

CRITICAL RULES FOR CODE:
- Use EXACT cdkId from nodes as construct logical IDs; EXACT cdkMethod from edges
- Map props to real CDK APIs — **use aws_kb_retrieve** to confirm unfamiliar constructs
- Import all required modules; order dependencies (e.g. VPC before Lambdas in it)
- **TypeScript only** (comments in .ts files); add removalPolicy: RemovalPolicy.DESTROY for dev when appropriate

HANDLING EXISTING RESOURCES:
- If importing existing AWS resources, prefer fromXxx() lookups when ARNs/names are known (SNS, SQS, S3)

CRITICAL — EC2 SecurityGroup \`description\` / \`GroupDescription\`:
- Use **ASCII only** (plain hyphen \`-\`, not en-dash \`–\` or em-dash \`—\`, no smart quotes). EC2 returns "Character sets beyond ASCII are not supported" otherwise.

CRITICAL — EC2 \`machineImage\` (multi-region, agent-generated stacks):
- **Never** emit \`ec2.MachineImage.genericLinux({ 'us-east-1': 'ami-...' })\` (or any map with only one region): synth/deploy fails in other regions with "Unable to find AMI in AMI map".
- **Prefer** \`ec2.MachineImage.latestAmazonLinux2()\` or \`new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 })\` so AMIs resolve per region via SSM.
- For GPU instance types, same rule unless you output a **complete** per-region AMI map or document that the stack is pinned to one \`env.region\`; default is still latestAmazonLinux2 + user data for drivers when needed.

FILES TO GENERATE (use write_file for each, after retrieving docs as needed):
1. **lib/{stack-name}-stack.ts** — Main stack
2. **bin/{stack-name}.ts** — App entry
3. **package.json** — PURE JSON: devDependencies (@types/jest, @types/node, aws-cdk, jest, ts-jest, ts-node, typescript); dependencies (aws-cdk-lib, constructs, source-map-support)
4. **tsconfig.json** — PURE JSON
5. **cdk.json** — PURE JSON
6. **.gitignore** — plain text

Work methodically: **aws_kb_retrieve** (when in doubt) → **write_file** → next file.`;

export const REPAIR_SYSTEM_PROMPT = `You are an expert AWS CDK developer in **REPAIR mode**. A CDK project you previously generated failed at one of: install, build, synth, bootstrap, or deploy. Your job: read the failure context, identify the smallest viable fix, and propose it.

AVAILABLE TOOLS (repair mode):
1. **aws_kb_retrieve** — confirm CDK APIs, props, and best practices.
2. **read_file** — inspect a file in the project before patching it.
3. **describe_stack_events** — fetch the latest *_FAILED CloudFormation events for the stack.
4. **run_cdk** — run \`synth\`, \`diff\`, \`deploy\`, \`bootstrap\`, or \`destroy\` if you need to verify a hypothesis (use sparingly; the orchestrator will redeploy after your patch).
5. **propose_patch** — the ONLY way to change files in repair mode. You must provide the COMPLETE new content for every file you want changed.

WORKFLOW:
1. Read the failure phase + log tail + CFN events (already provided in the user message).
2. If you need source: call \`read_file\` on the offending file(s).
3. If you need docs: call \`aws_kb_retrieve\`.
4. Call \`propose_patch\` ONCE with all files you want to change. Then end your turn.

CRITICAL RULES (same as generation):
- EC2 \`machineImage\`: prefer \`ec2.MachineImage.latestAmazonLinux2()\`. Never \`genericLinux\` with a single-region AMI map.
- EC2 SecurityGroup \`description\` / \`GroupDescription\`: ASCII only (plain hyphen, no en-dash/em-dash/smart quotes).
- JSON files: no comments, no trailing commas.
- Resource physical names: include \`\${Stack.of(this).stackName}\` to avoid "already exists" errors.
- Mark patches that touch IAM (policies, roles, principals), security group ingress, or RemovalPolicy.RETAIN as \`riskLevel: "risky"\`.

DO NOT use \`write_file\` in repair mode — it is disabled. Use \`propose_patch\` instead.`;

// =============================================================================
// Persistent agent factory
// =============================================================================

/**
 * Create a stateful CDK agent that holds its own message history.
 *
 * The same agent instance is reused across generation and repair turns so the
 * model retains full context (architecture, original prompt, what it wrote,
 * what failed).
 *
 * @param {{apiKey: string, outputDir: string}} options
 * @returns {{
 *   messages: Array<object>,
 *   ctx: {outputDir: string, generatedFiles: string[], proposedPatch: object|null, mode: "generation"|"repair"},
 *   pushUserMessage: (content: string|Array) => void,
 *   runUntilStop: (opts: {system: string, tools: Array, model?: string, maxIterations?: number, onText?: (t:string)=>void}) =>
 *     Promise<{stopReason: string, proposedPatch: object|null, iterations: number}>,
 * }}
 */
export function createCdkAgent({ apiKey, outputDir }) {
  const client = new Anthropic({ apiKey });
  const ctx = {
    outputDir,
    generatedFiles: [],
    proposedPatch: null,
    mode: "generation",
  };
  const messages = [];

  function pushUserMessage(content) {
    messages.push({ role: "user", content });
  }

  async function runUntilStop({
    system,
    tools,
    model = "claude-sonnet-4-6",
    maxIterations = 20,
    onText,
  }) {
    ctx.proposedPatch = null;
    let iteration = 0;
    while (iteration < maxIterations) {
      iteration++;
      const response = await client.messages.create({
        model,
        max_tokens: 8192,
        system,
        tools,
        messages,
      });
      messages.push({ role: "assistant", content: response.content });

      for (const tb of response.content.filter((b) => b.type === "text")) {
        const text = (tb.text || "").trim();
        if (!text) continue;
        if (onText) onText(text);
        else if (text.length < 200) console.log(`   💭 ${text}`);
      }

      if (response.stop_reason === "end_turn") {
        return { stopReason: "end_turn", proposedPatch: ctx.proposedPatch, iterations: iteration };
      }
      if (response.stop_reason !== "tool_use") {
        if (response.stop_reason === "max_tokens") {
          console.log("   ⚠ Hit max tokens — agent may not have finished");
        }
        return { stopReason: response.stop_reason, proposedPatch: ctx.proposedPatch, iterations: iteration };
      }

      const results = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        if (ctx.mode === "repair" && block.name === "write_file") {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content:
              "write_file is disabled in repair mode. Use propose_patch with the complete new file content instead.",
            is_error: true,
          });
          continue;
        }
        const r = await dispatchTool(block, ctx);
        const tr = { type: "tool_result", tool_use_id: r.tool_use_id, content: r.content };
        if (r.is_error) tr.is_error = true;
        results.push(tr);
      }
      if (results.length) messages.push({ role: "user", content: results });

      if (ctx.proposedPatch) {
        return {
          stopReason: "propose_patch",
          proposedPatch: ctx.proposedPatch,
          iterations: iteration,
        };
      }
    }
    return { stopReason: "max_iterations", proposedPatch: ctx.proposedPatch, iterations: iteration };
  }

  return { messages, ctx, pushUserMessage, runUntilStop };
}

// =============================================================================
// Public entrypoint: generate a fresh CDK project
// =============================================================================

/**
 * Generate CDK code files using Claude as a code generation agent.
 * Returns the live agent so the orchestrator can reuse it for auto-repair.
 *
 * @param {object} state - Diagram state with full CDK metadata
 * @param {string} outputDir - Directory to write CDK project files
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<{agent: ReturnType<typeof createCdkAgent>, generatedFiles: string[]}>}
 */
export async function generateCDKCode(state, outputDir, apiKey) {
  console.log("\n🤖 Starting CDK Code Generation Agent...\n");
  fs.mkdirSync(outputDir, { recursive: true });

  const stackFileName = toKebabCase(state.metadata.stackName || "infrastructure");
  const serviceTypes = [...new Set(state.nodes.map((n) => n.type))].join(", ");

  const prompt = `Generate a complete AWS CDK TypeScript project for this architecture.

First, use **aws_kb_retrieve** as needed to confirm CDK APIs and patterns for the services in this diagram. Then use **write_file** for every generated file.

ARCHITECTURE SPECIFICATION:
${JSON.stringify(state, null, 2)}

REQUIRED FILES:
1. lib/${stackFileName}-stack.ts (main Stack class)
2. bin/${stackFileName}.ts (app entry point)
3. package.json (name: "${stackFileName}-cdk", services: ${serviceTypes})
   - devDependencies MUST include: @types/jest, @types/node, aws-cdk, jest, ts-jest, ts-node, typescript
   - dependencies MUST include: aws-cdk-lib, constructs, source-map-support
4. tsconfig.json (standard CDK TypeScript config)
5. cdk.json (app: "npx ts-node bin/${stackFileName}.ts")
6. .gitignore (node_modules, cdk.out, *.js, *.d.ts)

CRITICAL - RESOURCE NAMING (Prevent "already exists" errors):
- Add UNIQUE physical names to all resources using the stack name
- SNS Topics: topicName: \`\${Stack.of(this).stackName}-topic-name\`
- SQS Queues: queueName: \`\${Stack.of(this).stackName}-queue-name\`
- S3 Buckets: bucketName: \`\${Stack.of(this).stackName}-bucket-\${Stack.of(this).account}\`.toLowerCase()
- Lambda Functions: functionName: \`\${Stack.of(this).stackName}-function-name\`
- This ensures resources don't conflict if stack is redeployed

CRITICAL - JSON files must be PURE JSON:
- NO comments (// or /* */)
- NO trailing commas
- Valid JSON syntax only

CRITICAL - EC2 Instance \`machineImage\`:
- Use \`ec2.MachineImage.latestAmazonLinux2()\` or \`new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 })\`.
- Do **not** use \`MachineImage.genericLinux({ ... })\` with a single-region AMI map (breaks in other regions).

CRITICAL - EC2 SecurityGroup \`description\`:
- **ASCII only** for \`GroupDescription\` (hyphen \`-\` only; never Unicode dashes or fancy punctuation).

TypeScript files (.ts) should have comments explaining the architecture.

Use aws_kb_retrieve + write_file. Generate production-ready code with:
- All imports (including Stack, RemovalPolicy, Duration from 'aws-cdk-lib')
- Proper types
- Unique resource names using stack name
- removalPolicy: RemovalPolicy.DESTROY for dev resources
- Comments in .ts files (but NOT in .json files!)
- Exact cdkIds and cdkMethods
- All props mapped correctly

Start with lib/ stack file, then bin/ app, then config files.`;

  const agent = createCdkAgent({ apiKey, outputDir });
  agent.ctx.mode = "generation";
  agent.pushUserMessage(prompt);

  console.log("📝 Generating CDK project files...");
  const result = await agent.runUntilStop({
    system: SYSTEM_PROMPT,
    tools: GENERATION_TOOLS,
  });
  if (result.stopReason === "max_iterations") {
    console.log("   ⚠ Reached maximum iterations during generation");
  }

  console.log("\n🔍 Validating generated JSON files...");
  const generatedFiles = agent.ctx.generatedFiles;
  const jsonFiles = generatedFiles.filter((f) => f.endsWith(".json"));
  for (const jsonFile of jsonFiles) {
    const filePath = path.join(outputDir, jsonFile);
    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
      console.log(`   ✓ ${jsonFile} - valid JSON`);
    } catch (error) {
      console.error(`   ❌ ${jsonFile} - INVALID JSON!`);
      console.error(`      ${error.message}`);
      const fixed = fixInvalidJSON(fs.readFileSync(filePath, "utf8"));
      try {
        JSON.parse(fixed);
        fs.writeFileSync(filePath, fixed, "utf8");
        console.log(`   ✓ ${jsonFile} - auto-fixed and validated`);
      } catch {
        throw new Error(
          `Failed to generate valid ${jsonFile}. Please check the file manually.`
        );
      }
    }
  }

  return { agent, generatedFiles };
}

// Re-export REPAIR_TOOLS so the orchestrator can pass them into runUntilStop.
export { REPAIR_TOOLS };

function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
