import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const SYSTEM_PROMPT = `You are an expert AWS CDK developer. Generate production-ready CDK TypeScript code from architecture diagrams.

CRITICAL RULES FOR JSON FILES:
- **NEVER** include comments in JSON files (package.json, tsconfig.json, cdk.json)
- JSON does not support comments - files must be valid JSON
- No // comments, no /* */ comments, no trailing commas
- Validate JSON syntax before writing

CRITICAL RULES FOR RESOURCE NAMING:
- **ADD UNIQUE SUFFIXES** to all resource names to avoid conflicts
- Use stack name or random suffix in physical resource names
- Example: topicName: \`\${stackName}-notifications-topic\`
- This prevents "resource already exists" errors on redeployment
- For SNS topics, SQS queues, S3 buckets: always include unique identifiers

CRITICAL RULES FOR CODE:
- Use EXACT cdkId from nodes as construct IDs (logical IDs)
- Use EXACT cdkMethod from edges for integrations
- Map ALL props correctly to CDK construct properties
- Import all required modules
- Handle dependencies (e.g., create VPC before using it)
- Use proper TypeScript types
- Add helpful comments in TypeScript files only
- Add removalPolicy: RemovalPolicy.DESTROY for development resources

HANDLING EXISTING RESOURCES:
- If a resource might already exist, use lookup methods:
  - SNS: Topic.fromTopicArn() if ARN is known
  - SQS: Queue.fromQueueArn() if ARN is known
  - S3: Bucket.fromBucketName() if name is known
- For new resources, add unique physical names to avoid conflicts

FILES TO GENERATE:
1. **lib/{stack-name}-stack.ts** - Main CDK Stack (TypeScript, comments OK)
2. **bin/{stack-name}.ts** - CDK App Entry Point (TypeScript, comments OK)
3. **package.json** - Dependencies (PURE JSON, NO COMMENTS)
   - devDependencies: @types/jest, @types/node, aws-cdk, jest, ts-jest, ts-node, typescript
   - dependencies: aws-cdk-lib, constructs, source-map-support
4. **tsconfig.json** - TypeScript Config (PURE JSON, NO COMMENTS)
5. **cdk.json** - CDK Config (PURE JSON, NO COMMENTS)
6. **.gitignore** - Git Ignore (plain text, comments OK)

Use write_file for each file. Work methodically through all 6 files.`;

const TOOLS = [
  {
    name: "write_file",
    description: "Write a file to the CDK project directory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root (e.g. 'lib/my-stack.ts')" },
        content: { type: "string", description: "Complete file content" },
      },
      required: ["path", "content"],
    },
  },
];

/**
 * Generate CDK code files using Claude as a code generation agent
 * @param {object} state - The diagram state with full CDK metadata
 * @param {string} outputDir - Directory to write CDK project files
 * @param {string} apiKey - Anthropic API key
 * @returns {Promise<string[]>} - List of generated files
 */
export async function generateCDKCode(state, outputDir, apiKey) {
  console.log("\n🤖 Starting CDK Code Generation Agent...\n");

  // Create output directory structure
  fs.mkdirSync(outputDir, { recursive: true });

  const client = new Anthropic({ apiKey });

  const stackFileName = toKebabCase(state.metadata.stackName || "infrastructure");
  const serviceTypes = [...new Set(state.nodes.map(n => n.type))].join(", ");

  // Single comprehensive prompt
  const prompt = `Generate a complete AWS CDK TypeScript project for this architecture.

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

TypeScript files (.ts) should have comments explaining the architecture.

Use write_file for each file. Generate production-ready code with:
- All imports (including Stack, RemovalPolicy, Duration from 'aws-cdk-lib')
- Proper types
- Unique resource names using stack name
- removalPolicy: RemovalPolicy.DESTROY for dev resources
- Comments in .ts files (but NOT in .json files!)
- Exact cdkIds and cdkMethods
- All props mapped correctly

Start with lib/ stack file, then bin/ app, then config files.`;

  console.log("📝 Generating CDK project files...");

  const messages = [{ role: "user", content: prompt }];
  const generatedFiles = await runGenerationAgent(client, messages, outputDir);

  // Validate JSON files
  console.log("\n🔍 Validating generated JSON files...");
  const jsonFiles = generatedFiles.filter(f => f.endsWith('.json'));
  for (const jsonFile of jsonFiles) {
    const filePath = path.join(outputDir, jsonFile);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      JSON.parse(content); // Will throw if invalid
      console.log(`   ✓ ${jsonFile} - valid JSON`);
    } catch (error) {
      console.error(`   ❌ ${jsonFile} - INVALID JSON!`);
      console.error(`      ${error.message}`);

      // Try to fix common issues
      const content = fs.readFileSync(filePath, 'utf8');
      const fixed = fixInvalidJSON(content);
      try {
        JSON.parse(fixed);
        fs.writeFileSync(filePath, fixed, 'utf8');
        console.log(`   ✓ ${jsonFile} - auto-fixed and validated`);
      } catch {
        throw new Error(`Failed to generate valid ${jsonFile}. Please check the file manually.`);
      }
    }
  }

  return generatedFiles;
}

/**
 * Run the code generation agent with tool calling
 */
async function runGenerationAgent(client, messages, outputDir) {
  const generatedFiles = [];
  let iteration = 0;
  const MAX_ITERATIONS = 20;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Check for text content
    const textBlocks = response.content.filter(block => block.type === "text");
    if (textBlocks.length > 0 && textBlocks[0].text.trim()) {
      const text = textBlocks[0].text.trim();
      if (text.length < 200) {
        console.log(`   💭 ${text}`);
      }
    }

    if (response.stop_reason === "end_turn") {
      break;
    }

    if (response.stop_reason === "tool_use") {
      const results = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "write_file") {
          const filePath = path.join(outputDir, block.input.path);
          const fileDir = path.dirname(filePath);

          fs.mkdirSync(fileDir, { recursive: true });

          let content = block.input.content;

          // Extra validation for JSON files
          if (block.input.path.endsWith('.json')) {
            content = fixInvalidJSON(content);
          }

          fs.writeFileSync(filePath, content, "utf8");

          generatedFiles.push(block.input.path);
          console.log(`   ✓ ${block.input.path} (${content.length} bytes)`);

          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `Success. File written to ${block.input.path}`,
          });
        }
      }

      if (results.length > 0) {
        messages.push({ role: "user", content: results });
      }
    } else if (response.stop_reason === "max_tokens") {
      console.log("   ⚠ Hit max tokens - agent may not have finished");
      break;
    } else {
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log("   ⚠ Reached maximum iterations");
  }

  return generatedFiles;
}

/**
 * Fix common JSON issues (comments, trailing commas)
 */
function fixInvalidJSON(content) {
  // Remove single-line comments
  content = content.replace(/\/\/.*$/gm, '');

  // Remove multi-line comments
  content = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // Remove trailing commas before closing braces/brackets
  content = content.replace(/,(\s*[}\]])/g, '$1');

  // Remove empty lines
  content = content.split('\n').filter(line => line.trim()).join('\n');

  return content;
}

/**
 * Convert string to kebab-case
 */
function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}
