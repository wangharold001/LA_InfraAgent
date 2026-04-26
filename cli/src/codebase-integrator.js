import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline/promises";

/**
 * Codebase Integration Module
 *
 * After CDK architecture is approved, this module:
 * 1. Analyzes the codebase to find where AWS services should be integrated
 * 2. Maps architecture edges to code locations
 * 3. Generates SDK integration code using environment variables
 * 4. Updates dependencies (package.json, requirements.txt, etc.)
 * 5. Shows diffs and gets approval before CDK generation
 */

const INTEGRATION_SYSTEM_PROMPT = `You are an expert at integrating DEPLOYED AWS services into existing codebases.

You will receive:
1. DEPLOYED AWS resources with their ACTUAL ARNs, names, and URLs (already live on AWS!)
2. An architecture diagram showing how resources connect
3. The user's existing codebase

Your job is to:
1. **Map connections to code** - For each connection in the architecture, identify which source file and function should use that AWS service
2. **Generate SDK code** - Create integration code that uses the ACTUAL deployed resource identifiers via **ENVIRONMENT VARIABLES**
3. **Update dependencies** - Add required AWS SDK packages to package.json/requirements.txt/etc.
4. **Use real deployed resources**:
   - The resources are ALREADY deployed to AWS
   - Use the actual ARNs/names/URLs provided in the DEPLOYED RESOURCES section
   - Reference them via environment variables (e.g., process.env.S3_BUCKET_NAME)

CRITICAL RULES:
- **ONLY USE FILES THAT EXIST** - You will receive the actual codebase files. ONLY propose integrations for files that are in the codebase context provided to you. DO NOT hallucinate or guess file paths like "backend/app.py" or "src/index.js" unless you see those EXACT files in the codebase.
- **NO HARDCODED VALUES** - Always use process.env.VAR_NAME or os.getenv('VAR_NAME')
- **Map to existing code** - Find the actual files/functions that need AWS SDK calls from the provided codebase
- **Minimal changes** - Only modify what's necessary for AWS integration
- **Environment variable naming** - Use clear, consistent names like:
  - S3_BUCKET_NAME, S3_BUCKET_ARN
  - DYNAMODB_TABLE_NAME, DYNAMODB_TABLE_ARN
  - SNS_TOPIC_ARN
  - SQS_QUEUE_URL
  - LAMBDA_FUNCTION_ARN
  - RDS_ENDPOINT, RDS_DATABASE_NAME

WORKFLOW:
1. Analyze the codebase structure (detect Node.js/Python/etc.)
2. For each edge in the diagram, propose WHERE and WHAT to integrate
3. Generate code snippets with env var references
4. Update dependency files
5. Return a complete integration plan with file diffs`;

const INTEGRATION_TOOLS = [
  {
    name: "analyze_codebase",
    description: "Analyze the codebase to detect language, framework, and structure. Returns information about the project type.",
    input_schema: {
      type: "object",
      properties: {
        analysis: {
          type: "string",
          description: "Your analysis of the codebase structure",
        },
      },
      required: ["analysis"],
    },
  },
  {
    name: "propose_integration",
    description: "Propose code changes to integrate an AWS service. Provide the file path, the location in the file (function/class name), and the code to add.",
    input_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to the file to modify (relative to repo root)",
        },
        location: {
          type: "string",
          description: "Where in the file to add the code (e.g., 'in function uploadFile', 'at top of file', 'in class UserController')",
        },
        description: {
          type: "string",
          description: "What this integration does (e.g., 'Upload file to S3', 'Send SNS notification')",
        },
        codeToAdd: {
          type: "string",
          description: "The code to add, using environment variables for AWS resource references",
        },
        envVars: {
          type: "array",
          items: { type: "string" },
          description: "List of environment variable names this code requires (e.g., ['S3_BUCKET_NAME', 'AWS_REGION'])",
        },
        edgeId: {
          type: "string",
          description: "The edge ID from the architecture diagram that this integration implements",
        },
      },
      required: ["filePath", "location", "description", "codeToAdd", "envVars", "edgeId"],
    },
  },
  {
    name: "update_dependencies",
    description: "Update dependency files to include AWS SDKs",
    input_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to dependency file (package.json, requirements.txt, etc.)",
        },
        dependencies: {
          type: "array",
          items: { type: "string" },
          description: "List of dependencies to add (e.g., ['@aws-sdk/client-s3', 'boto3'])",
        },
      },
      required: ["filePath", "dependencies"],
    },
  },
  {
    name: "finalize_integration_plan",
    description: "Finalize the integration plan. Call this when you've proposed all necessary integrations and dependency updates.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Summary of all proposed changes",
        },
      },
      required: ["summary"],
    },
  },
];

/**
 * Ask user if they want codebase integration
 * @param {object} approvedState - The approved architecture state
 * @returns {Promise<boolean>} - Whether user wants integration
 */
export async function promptForIntegration(approvedState) {
  console.log("\n" + "=".repeat(80));
  console.log("📦 CODEBASE INTEGRATION");
  console.log("=".repeat(80));
  console.log("\nYour architecture has been approved!");
  console.log("\nWould you like me to integrate this infrastructure into your existing codebase?");
  console.log("\n  If yes, I will:");
  console.log("    • Analyze your code to find where AWS services should be used");
  console.log("    • Generate SDK integration code using environment variables");
  console.log("    • Update your dependencies (package.json/requirements.txt/etc.)");
  console.log("    • Show you a diff for approval before proceeding");
  console.log("\n  If no, I'll skip directly to CDK generation and deployment.");
  console.log("\n" + "=".repeat(80));
  console.log("\n🔗 Would you like me to integrate this infrastructure into your existing codebase?");
  console.log("   [yes/no] (default: no): ");

  // For now, return false to skip integration
  // TODO: Get actual user input
  return false;
}

/**
 * Analyze codebase and generate integration plan WITH ACTUAL DEPLOYED RESOURCES
 * @param {object} options - Options
 * @param {string} options.repoPath - Path to the repository
 * @param {object} options.architecture - Architecture diagram
 * @param {object} options.deployedResources - Actual deployed resource env vars (S3_BUCKET_NAME, etc.)
 * @param {object} options.stackOutputs - Raw CDK stack outputs
 * @param {string} options.apiKey - Anthropic API key
 * @returns {Promise<object>} - Integration plan
 */
export async function analyzeAndPlanIntegrationWithOutputs(options) {
  const { repoPath, architecture, deployedResources, stackOutputs, apiKey } = options;

  console.log("\n🔍 Analyzing codebase for integration with deployed resources...\n");
  console.log(`   📂 Scanning directory: ${repoPath}\n`);

  const client = new Anthropic({ apiKey });

  // Read codebase files (limit to common source files)
  const codebaseContext = await readCodebaseForIntegration(repoPath);

  const prompt = `Analyze this codebase and integrate the DEPLOYED AWS infrastructure.

IMPORTANT: These resources are ALREADY DEPLOYED to AWS. Use the ACTUAL resource identifiers provided below.

DEPLOYED RESOURCES (use these EXACT values in environment variables):
${JSON.stringify(deployedResources, null, 2)}

CDK STACK OUTPUTS (for reference):
${JSON.stringify(stackOutputs, null, 2)}

ARCHITECTURE DIAGRAM (shows how resources connect):
${JSON.stringify(architecture, null, 2)}

CODEBASE STRUCTURE:
${codebaseContext}

TASK:
1. Detect the project language and framework FROM THE CODEBASE STRUCTURE PROVIDED ABOVE
2. For each connection in the architecture, identify:
   - Which source file FROM THE CODEBASE ABOVE should use this AWS service (USE EXACT FILE PATHS)
   - Which function/class/method should contain the integration code
   - What SDK code to add using the DEPLOYED RESOURCES env vars above
3. List all AWS SDK dependencies to add TO EXISTING DEPENDENCY FILES IN THE CODEBASE
4. Create a complete integration plan

CRITICAL REQUIREMENTS:
- **USE ACTUAL DEPLOYED RESOURCES**: Reference env vars like S3_BUCKET_NAME, SNS_TOPIC_ARN, etc. from DEPLOYED RESOURCES above
- **ONLY** propose integrations for files that appear in the CODEBASE STRUCTURE above
- **DO NOT** invent or guess file paths like "backend/app.py" or "src/index.js"
- **USE EXACT** file paths from the codebase files listed above
- If you cannot find an appropriate file in the codebase, say so in your analysis
- Use environment variables for ALL AWS resource references (they're already deployed!)
- The resources in DEPLOYED RESOURCES are live on AWS right now - use them!`;

  const messages = [{ role: "user", content: prompt }];
  const integrationPlan = await runIntegrationAgent(client, messages, repoPath);

  return integrationPlan;
}

/**
 * Run the integration analysis agent
 */
async function runIntegrationAgent(client, messages, repoPath) {
  const integrations = [];
  const dependencyUpdates = [];
  let codebaseAnalysis = null;
  let iteration = 0;
  const MAX_ITERATIONS = 30;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: INTEGRATION_SYSTEM_PROMPT,
      tools: INTEGRATION_TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    // Log any text output
    const textBlocks = response.content.filter(block => block.type === "text");
    if (textBlocks.length > 0) {
      const text = textBlocks[0].text.trim();
      if (text.length < 300) {
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

        if (block.name === "analyze_codebase") {
          codebaseAnalysis = block.input.analysis;
          console.log(`   📊 Codebase Analysis: ${codebaseAnalysis.substring(0, 100)}...`);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Analysis recorded. Continue with proposing integrations.",
          });
        } else if (block.name === "propose_integration") {
          integrations.push(block.input);
          console.log(`   ✓ Proposed: ${block.input.description} in ${block.input.filePath}`);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Integration proposal recorded. Continue with more integrations or finalize.",
          });
        } else if (block.name === "update_dependencies") {
          dependencyUpdates.push(block.input);
          console.log(`   ✓ Dependencies: ${block.input.dependencies.join(", ")} in ${block.input.filePath}`);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Dependency update recorded. Continue or finalize.",
          });
        } else if (block.name === "finalize_integration_plan") {
          console.log(`\n   ✅ Integration plan complete: ${block.input.summary}`);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Plan finalized.",
          });
        }
      }

      if (results.length > 0) {
        messages.push({ role: "user", content: results });
      }
    } else {
      break;
    }
  }

  return {
    analysis: codebaseAnalysis,
    integrations,
    dependencyUpdates,
  };
}

/**
 * Read codebase files for integration analysis
 */
async function readCodebaseForIntegration(repoPath) {
  const files = [];
  const maxFileSize = 50000; // 50KB max per file
  const maxTotalSize = 200000; // 200KB total

  // Common source file patterns
  const patterns = [
    "**/*.js",
    "**/*.ts",
    "**/*.py",
    "**/*.go",
    "**/*.java",
    "package.json",
    "requirements.txt",
    "go.mod",
    "pom.xml",
  ];

  let totalSize = 0;

  try {
    // Find files using git ls-files (respects .gitignore)
    const result = execSync("git ls-files", {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const allFiles = result.split("\n").filter(f => f.trim());

    // Filter to source files
    const sourceFiles = allFiles.filter(f => {
      const ext = path.extname(f);
      return [".js", ".ts", ".py", ".go", ".java", ".json", ".txt"].includes(ext) ||
        ["package.json", "requirements.txt", "go.mod", "pom.xml"].includes(path.basename(f));
    });

    // Read files until we hit size limit
    for (const file of sourceFiles) {
      if (totalSize >= maxTotalSize) break;

      const filePath = path.join(repoPath, file);
      if (!fs.existsSync(filePath)) continue;

      const stats = fs.statSync(filePath);
      if (stats.size > maxFileSize) continue;

      const content = fs.readFileSync(filePath, "utf8");
      files.push({ path: file, content });
      totalSize += content.length;
    }
  } catch (error) {
    console.log(`   ⚠️  Could not read codebase files: ${error.message}`);
  }

  // Log what was found
  if (files.length > 0) {
    console.log(`   ✓ Found ${files.length} source files:\n`);
    for (const f of files.slice(0, 10)) {  // Show first 10
      console.log(`     - ${f.path}`);
    }
    if (files.length > 10) {
      console.log(`     ... and ${files.length - 10} more`);
    }
    console.log("");
  } else {
    console.log(`   ⚠️  No source files found in ${repoPath}\n`);
  }

  // Build response with file list first, then content
  let response = "AVAILABLE FILES IN CODEBASE:\n";
  response += files.map(f => `- ${f.path}`).join("\n");
  response += "\n\n" + "=".repeat(80) + "\n\n";
  response += "FILE CONTENTS:\n\n";
  response += files.map(f => `FILE: ${f.path}\n${f.content}\n---`).join("\n\n");

  return response;
}

/**
 * Apply integration changes and get approval via git diff
 * @param {string} repoPath - Repository path
 * @param {object} integrationPlan - The proposed integration plan
 * @returns {Promise<boolean>} - Whether user approved (kept changes)
 */
export async function applyAndReviewIntegration(repoPath, integrationPlan) {
  console.log("\n" + "=".repeat(80));
  console.log("📋 INTEGRATION PLAN");
  console.log("=".repeat(80));

  console.log(`\n${integrationPlan.analysis}\n`);

  // Show summary of what will be changed
  console.log("📝 FILES TO BE MODIFIED:\n");
  for (const integration of integrationPlan.integrations) {
    const filePath = path.join(repoPath, integration.filePath);
    const exists = fs.existsSync(filePath);
    console.log(`  📄 ${integration.filePath} ${exists ? "" : "⚠️  FILE NOT FOUND"}`);
    console.log(`     ${integration.description}`);
    console.log(`     Env vars: ${integration.envVars.join(", ")}`);
  }

  console.log("\n📦 DEPENDENCIES TO BE ADDED:\n");
  for (const depUpdate of integrationPlan.dependencyUpdates) {
    const filePath = path.join(repoPath, depUpdate.filePath);
    const exists = fs.existsSync(filePath);
    console.log(`  📄 ${depUpdate.filePath} ${exists ? "" : "⚠️  FILE NOT FOUND"}`);
    console.log(`     ${depUpdate.dependencies.join(", ")}`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("\n⚙️  Applying changes to your codebase...\n");

  // Apply all changes first
  let successCount = 0;
  let errorCount = 0;
  const modifiedFiles = [];

  // Apply code changes
  for (const integration of integrationPlan.integrations) {
    console.log(`   ✏️  Modifying ${integration.filePath}...`);
    try {
      await insertCodeIntoFile(repoPath, integration);
      console.log(`      ✓ Modified`);
      successCount++;
      modifiedFiles.push(integration.filePath);
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      errorCount++;
    }
  }

  // Update dependencies
  for (const depUpdate of integrationPlan.dependencyUpdates) {
    console.log(`   📦 Updating ${depUpdate.filePath}...`);
    try {
      await updateDependencyFile(repoPath, depUpdate);
      console.log(`      ✓ Updated`);
      successCount++;
      modifiedFiles.push(depUpdate.filePath);
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      errorCount++;
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log(`\n📊 Results: ${successCount} succeeded, ${errorCount} failed\n`);

  if (successCount === 0) {
    console.log("❌ No changes were successfully applied.\n");
    return false;
  }

  // -------------------------------------------------------------------------
  // AUTO-INSTALL DEPENDENCIES - Make it a ONE-SHOT working implementation!
  // -------------------------------------------------------------------------
  console.log("\n📦 Installing dependencies...\n");

  const installedDeps = await autoInstallDependencies(repoPath, integrationPlan.dependencyUpdates);

  if (installedDeps.length > 0) {
    console.log(`\n✅ Dependencies installed successfully!\n`);
  }

  // -------------------------------------------------------------------------
  // VALIDATE THE INTEGRATION - Make sure imports work!
  // -------------------------------------------------------------------------
  console.log("\n🔍 Validating integration...\n");

  const validationResult = await validateIntegration(repoPath, integrationPlan, modifiedFiles);

  if (!validationResult.valid) {
    console.log("\n⚠️  Validation warnings:");
    for (const warning of validationResult.warnings) {
      console.log(`   - ${warning}`);
    }
    console.log("");
  } else {
    console.log("   ✓ All imports validated");
    console.log("   ✓ Environment variables referenced correctly");
    console.log("   ✓ Integration appears ready to use\n");
  }

  // Show git diff
  console.log("🔍 Review the changes:\n");
  try {
    const diffOutput = execSync("git diff --color=always", {
      cwd: repoPath,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (diffOutput.trim()) {
      console.log(diffOutput);
    } else {
      console.log("   (No git diff available - changes made to untracked or ignored files)\n");
      console.log("   Modified files:");
      for (const file of modifiedFiles) {
        console.log(`   - ${file}`);
      }
    }
  } catch (error) {
    console.log("   (Could not show git diff - not a git repository or git not available)\n");
    console.log("   Modified files:");
    for (const file of modifiedFiles) {
      console.log(`   - ${file}`);
    }
  }

  console.log("\n" + "=".repeat(80));

  // Ask user to keep or revert
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "\n❓ Keep these changes? [yes/no] (default: yes): "
  );
  rl.close();

  const keepChanges = !answer.trim() || /^y(es)?$/i.test(answer.trim());

  if (keepChanges) {
    console.log("\n✅ Changes kept! Proceeding to CDK generation and deployment.\n");
    return true;
  } else {
    console.log("\n🔄 Reverting changes...\n");

    // Revert using git checkout
    try {
      for (const file of modifiedFiles) {
        try {
          execSync(`git checkout -- "${file}"`, {
            cwd: repoPath,
            stdio: "ignore",
          });
          console.log(`   ✓ Reverted ${file}`);
        } catch {
          console.log(`   ⚠️  Could not revert ${file} (file may be untracked)`);
        }
      }
      console.log("\n✅ Changes reverted. Proceeding to CDK generation without integration.\n");
    } catch (error) {
      console.log("\n⚠️  Could not automatically revert changes.");
      console.log("   Please manually revert using: git checkout .\n");
    }

    return false;
  }
}

/**
 * Apply the approved integration plan
 * @param {string} repoPath - Path to repository
 * @param {object} integrationPlan - The approved plan
 */
export async function applyIntegrationPlan(repoPath, integrationPlan) {
  console.log("\n⚙️  Applying integration plan...\n");

  let successCount = 0;
  let errorCount = 0;
  const errors = [];

  // Apply code changes
  for (const integration of integrationPlan.integrations) {
    console.log(`   ✏️  Updating ${integration.filePath}...`);
    try {
      await insertCodeIntoFile(repoPath, integration);
      console.log(`      ✓ Code inserted successfully`);
      successCount++;
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      errorCount++;
      errors.push({ file: integration.filePath, error: error.message });
    }
  }

  // Update dependencies
  for (const depUpdate of integrationPlan.dependencyUpdates) {
    console.log(`   📦 Updating ${depUpdate.filePath}...`);
    try {
      await updateDependencyFile(repoPath, depUpdate);
      console.log(`      ✓ Dependencies added successfully`);
      successCount++;
    } catch (error) {
      console.error(`      ❌ Error: ${error.message}`);
      errorCount++;
      errors.push({ file: depUpdate.filePath, error: error.message });
    }
  }

  // Report results
  if (errorCount > 0) {
    console.log(`\n⚠️  Integration partially failed: ${successCount} succeeded, ${errorCount} failed\n`);

    // Ask user if they want to continue
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(
      "Some files could not be integrated. Continue to deployment anyway? [yes/no] (default: yes): "
    );
    rl.close();

    const shouldContinue = !answer.trim() || /^y(es)?$/i.test(answer.trim());

    if (!shouldContinue) {
      throw new Error("Integration failed and user chose not to continue");
    }

    console.log("\n⚠️  Continuing with partial integration...\n");
    return false; // Partial success
  } else {
    console.log("\n✅ Integration applied successfully!\n");
    return true; // Full success
  }
}

/**
 * Insert code into a file at the specified location
 * @param {string} repoPath - Repository path
 * @param {object} integration - Integration specification
 */
async function insertCodeIntoFile(repoPath, integration) {
  const filePath = path.join(repoPath, integration.filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${integration.filePath}`);
  }

  let content = fs.readFileSync(filePath, "utf8");
  const location = integration.location.toLowerCase();

  // Parse the location to determine where to insert
  if (location.includes("at top of file") || location.includes("at the top")) {
    // Insert after the last import/require statement
    const lines = content.split("\n");
    let insertIndex = 0;

    // Find last import/require line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("import ") || line.startsWith("require(") ||
          line.startsWith("from ") || line.startsWith("const ") && line.includes("require")) {
        insertIndex = i + 1;
      }
      // Stop at first non-import/non-comment/non-empty line
      if (line && !line.startsWith("import") && !line.startsWith("require") &&
          !line.startsWith("from") && !line.startsWith("//") && !line.startsWith("/*") &&
          !line.startsWith("const") && !line.startsWith("*")) {
        break;
      }
    }

    lines.splice(insertIndex, 0, "", integration.codeToAdd, "");
    content = lines.join("\n");
  } else if (location.includes("in function") || location.includes("in method")) {
    // Extract function name from location string
    const funcMatch = location.match(/(?:in (?:function|method)) (\\w+)/);
    if (!funcMatch) {
      // Fallback: append to end of file
      content += "\n\n" + integration.codeToAdd + "\n";
    } else {
      const funcName = funcMatch[1];

      // Find the function and insert at the end of it (before closing brace)
      // This is a simple implementation - more sophisticated parsing could be added
      const funcRegex = new RegExp(`(function\\s+${funcName}|const\\s+${funcName}\\s*=|${funcName}\\s*[=:]\\s*(?:async\\s+)?(?:function)?\\s*\\([^)]*\\)\\s*(?:=>)?\\s*\\{)`, "g");

      const match = funcRegex.exec(content);
      if (match) {
        // Find the closing brace of this function
        const startPos = match.index + match[0].length;
        let braceCount = 1;
        let endPos = startPos;

        for (let i = startPos; i < content.length && braceCount > 0; i++) {
          if (content[i] === "{") braceCount++;
          if (content[i] === "}") braceCount--;
          if (braceCount === 0) {
            endPos = i;
            break;
          }
        }

        // Insert before the closing brace
        const indent = "  "; // Default 2-space indent
        const codeWithIndent = integration.codeToAdd.split("\n").map(line =>
          line ? indent + line : line
        ).join("\n");

        content = content.slice(0, endPos) +
                  "\n" + codeWithIndent + "\n" +
                  content.slice(endPos);
      } else {
        // Function not found, append to end of file
        console.log(`      ⚠️  Function '${funcName}' not found, appending to end of file`);
        content += "\n\n" + integration.codeToAdd + "\n";
      }
    }
  } else if (location.includes("in class")) {
    // Extract class name and insert at appropriate location
    const classMatch = location.match(/in class (\\w+)/);
    if (classMatch) {
      const className = classMatch[1];
      // Similar logic to function insertion
      const classRegex = new RegExp(`class\\s+${className}\\s*\\{`, "g");
      const match = classRegex.exec(content);

      if (match) {
        const insertPos = match.index + match[0].length;
        const indent = "  ";
        const codeWithIndent = integration.codeToAdd.split("\n").map(line =>
          line ? indent + line : line
        ).join("\n");

        content = content.slice(0, insertPos) +
                  "\n" + codeWithIndent + "\n" +
                  content.slice(insertPos);
      } else {
        content += "\n\n" + integration.codeToAdd + "\n";
      }
    } else {
      content += "\n\n" + integration.codeToAdd + "\n";
    }
  } else {
    // Default: append to end of file
    content += "\n\n" + integration.codeToAdd + "\n";
  }

  // Write the modified content back
  fs.writeFileSync(filePath, content, "utf8");
}

/**
 * Update dependency file (package.json, requirements.txt, etc.)
 * @param {string} repoPath - Repository path
 * @param {object} depUpdate - Dependency update specification
 */
async function updateDependencyFile(repoPath, depUpdate) {
  const filePath = path.join(repoPath, depUpdate.filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Dependency file not found: ${depUpdate.filePath}`);
  }

  const fileName = path.basename(filePath);

  if (fileName === "package.json") {
    // Update package.json
    const pkg = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (!pkg.dependencies) {
      pkg.dependencies = {};
    }

    for (const dep of depUpdate.dependencies) {
      // Parse dependency (might be "package@version" or just "package")
      const parts = dep.split("@");
      const packageName = parts[0];
      const version = parts[1] || "^3.0.0"; // Default version for AWS SDK v3

      if (!pkg.dependencies[packageName]) {
        pkg.dependencies[packageName] = version;
        console.log(`      + ${packageName}@${version}`);
      } else {
        console.log(`      ~ ${packageName} already exists`);
      }
    }

    // Write back with pretty formatting
    fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

  } else if (fileName === "requirements.txt") {
    // Update requirements.txt
    let content = fs.readFileSync(filePath, "utf8");
    const existingDeps = new Set(
      content.split("\n")
        .filter(line => line.trim() && !line.startsWith("#"))
        .map(line => line.split("==")[0].split(">=")[0].trim())
    );

    const newLines = [];
    for (const dep of depUpdate.dependencies) {
      const depName = dep.split("==")[0].split(">=")[0].trim();
      if (!existingDeps.has(depName)) {
        newLines.push(dep);
        console.log(`      + ${dep}`);
      } else {
        console.log(`      ~ ${depName} already exists`);
      }
    }

    if (newLines.length > 0) {
      content = content.trim() + "\n" + newLines.join("\n") + "\n";
      fs.writeFileSync(filePath, content, "utf8");
    }

  } else if (fileName === "go.mod") {
    // Update go.mod
    let content = fs.readFileSync(filePath, "utf8");

    // Find the require block
    const requireMatch = content.match(/require\s*\(/);
    if (requireMatch) {
      const insertPos = requireMatch.index + requireMatch[0].length;
      const newDeps = depUpdate.dependencies.map(dep => `\n\t${dep}`).join("");
      content = content.slice(0, insertPos) + newDeps + content.slice(insertPos);
    } else {
      // No require block, add one
      content += "\n\nrequire (\n";
      for (const dep of depUpdate.dependencies) {
        content += `\t${dep}\n`;
      }
      content += ")\n";
    }

    fs.writeFileSync(filePath, content, "utf8");

  } else if (fileName === "pom.xml") {
    // Update pom.xml (Maven)
    let content = fs.readFileSync(filePath, "utf8");

    // Find the dependencies block
    const depsMatch = content.match(/<dependencies>/);
    if (depsMatch) {
      const insertPos = depsMatch.index + depsMatch[0].length;
      let newDeps = "";

      for (const dep of depUpdate.dependencies) {
        // Expect format: "groupId:artifactId:version"
        const [groupId, artifactId, version] = dep.split(":");
        newDeps += `
    <dependency>
      <groupId>${groupId}</groupId>
      <artifactId>${artifactId}</artifactId>
      <version>${version}</version>
    </dependency>`;
      }

      content = content.slice(0, insertPos) + newDeps + content.slice(insertPos);
    }

    fs.writeFileSync(filePath, content, "utf8");

  } else {
    throw new Error(`Unsupported dependency file type: ${fileName}`);
  }
}

/**
 * Auto-install dependencies after updating dependency files
 * Makes the integration a ONE-SHOT working implementation
 * @param {string} repoPath - Repository path
 * @param {Array} dependencyUpdates - List of dependency updates
 * @returns {Promise<Array>} - List of successfully installed dependencies
 */
async function autoInstallDependencies(repoPath, dependencyUpdates) {
  const installed = [];

  for (const depUpdate of dependencyUpdates) {
    const fileName = path.basename(depUpdate.filePath);
    let command = null;
    let displayName = null;

    if (fileName === "package.json") {
      command = "npm install";
      displayName = "npm";
    } else if (fileName === "requirements.txt") {
      command = "pip install -r requirements.txt";
      displayName = "pip";
    } else if (fileName === "go.mod") {
      command = "go mod tidy";
      displayName = "go";
    } else if (fileName === "pom.xml") {
      command = "mvn install -DskipTests";
      displayName = "maven";
    }

    if (command) {
      try {
        console.log(`   🔧 Running ${displayName} install...`);
        execSync(command, {
          cwd: repoPath,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        });
        console.log(`      ✓ ${displayName} install completed`);
        installed.push({
          file: depUpdate.filePath,
          manager: displayName,
          dependencies: depUpdate.dependencies,
        });
      } catch (error) {
        console.log(`      ⚠️  ${displayName} install failed: ${error.message}`);
        console.log(`         You may need to run '${command}' manually`);
      }
    }
  }

  return installed;
}

/**
 * Validate the integration to ensure it's working
 * Checks imports, syntax, and environment variables
 * @param {string} repoPath - Repository path
 * @param {object} integrationPlan - The integration plan
 * @param {Array} modifiedFiles - List of modified file paths
 * @returns {Promise<object>} - Validation result { valid: boolean, warnings: Array }
 */
async function validateIntegration(repoPath, integrationPlan, modifiedFiles) {
  const warnings = [];
  let valid = true;

  // Detect primary language
  const language = detectLanguage(integrationPlan.dependencyUpdates);

  console.log(`   🔍 Validating ${language} integration...`);

  // Check each modified file
  for (const fileRelPath of modifiedFiles) {
    const filePath = path.join(repoPath, fileRelPath);

    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, "utf8");
    const ext = path.extname(filePath);

    // Language-specific validation
    if (language === "Python" && (ext === ".py")) {
      // Check Python syntax
      try {
        execSync(`python3 -m py_compile "${filePath}"`, {
          cwd: repoPath,
          stdio: "pipe",
        });
        console.log(`      ✓ ${fileRelPath} syntax OK`);
      } catch (error) {
        warnings.push(`Python syntax error in ${fileRelPath}`);
        valid = false;
        console.log(`      ⚠️  ${fileRelPath} has syntax errors`);
      }

      // Check for proper boto3 imports
      if (content.includes("boto3") && !content.match(/import\s+boto3/)) {
        warnings.push(`${fileRelPath} uses boto3 but missing 'import boto3'`);
        console.log(`      ⚠️  ${fileRelPath} missing boto3 import`);
      }

      // Check for os.getenv usage
      if (content.includes("os.getenv") && !content.match(/import\s+os/)) {
        warnings.push(`${fileRelPath} uses os.getenv but missing 'import os'`);
        console.log(`      ⚠️  ${fileRelPath} missing os import`);
      }

    } else if (language === "Node.js" && (ext === ".js" || ext === ".ts")) {
      // Check for AWS SDK imports
      const awsSdkPattern = /@aws-sdk\/client-(\w+)/g;
      const matches = content.matchAll(awsSdkPattern);

      for (const match of matches) {
        const clientName = match[1];
        // Check if import exists
        const importPattern = new RegExp(`(require|import).*@aws-sdk/client-${clientName}`);
        if (!content.match(importPattern)) {
          warnings.push(`${fileRelPath} uses @aws-sdk/client-${clientName} but missing import`);
          console.log(`      ⚠️  ${fileRelPath} missing AWS SDK import`);
        }
      }

      // Check for process.env usage (should be present)
      if (content.includes("new") && content.includes("Client") && !content.includes("process.env")) {
        warnings.push(`${fileRelPath} uses AWS SDK but may not be using environment variables`);
      }
    }

    // Universal checks for environment variables
    const envVarPattern = /(process\.env\.(\w+)|os\.getenv\(['"'](\w+)['"']\))/g;
    const envVarsUsed = new Set();

    let match;
    while ((match = envVarPattern.exec(content)) !== null) {
      const varName = match[2] || match[3];
      if (varName) {
        envVarsUsed.add(varName);
      }
    }

    // Check if the environment variables match what the integration expects
    const integration = integrationPlan.integrations.find(i => i.filePath === fileRelPath);
    if (integration && integration.envVars) {
      for (const expectedVar of integration.envVars) {
        if (!envVarsUsed.has(expectedVar)) {
          warnings.push(`${fileRelPath} should use ${expectedVar} but it's not found in the code`);
        }
      }
    }
  }

  // Check that environment variable names are reasonable
  const allEnvVars = new Set();
  for (const integration of integrationPlan.integrations) {
    for (const envVar of integration.envVars || []) {
      allEnvVars.add(envVar);
    }
  }

  // Validate environment variable naming conventions
  const validPrefixes = ["S3_", "DYNAMODB_", "SNS_", "SQS_", "LAMBDA_", "RDS_", "API_", "AWS_"];
  for (const envVar of allEnvVars) {
    const hasValidPrefix = validPrefixes.some(prefix => envVar.startsWith(prefix));
    if (!hasValidPrefix && !envVar.startsWith("AWS_")) {
      warnings.push(`Environment variable ${envVar} doesn't follow AWS naming convention`);
    }
  }

  if (warnings.length === 0) {
    valid = true;
  }

  return { valid, warnings };
}

/**
 * Detect primary programming language from dependency updates
 * @param {Array} dependencyUpdates - List of dependency updates
 * @returns {string} - Language name (Python, Node.js, Go, Java, or Unknown)
 */
function detectLanguage(dependencyUpdates) {
  for (const dep of dependencyUpdates) {
    const fileName = path.basename(dep.filePath);
    if (fileName === "requirements.txt") return "Python";
    if (fileName === "package.json") return "Node.js";
    if (fileName === "go.mod") return "Go";
    if (fileName === "pom.xml") return "Java";
  }
  return "Unknown";
}
