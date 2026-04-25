import { execSync } from "child_process";
import readline from "readline/promises";
import fs from "fs";
import path from "path";

/**
 * Deploy the CDK stack
 * @param {string} cdkDir - Directory containing the CDK project
 * @param {object} metadata - Stack metadata (region, account, etc.)
 * @returns {Promise<boolean>} - true if deployment succeeded
 */
export async function deployCDK(cdkDir, metadata) {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 CDK DEPLOYMENT");
  console.log("=".repeat(80));

  try {
    // Check if CDK CLI is installed
    console.log("\n🔍 Checking CDK CLI...");
    try {
      const cdkVersion = execSync("cdk --version", { encoding: "utf8" }).trim();
      console.log(`   ✓ Found: ${cdkVersion}`);
    } catch (error) {
      console.error("\n❌ AWS CDK CLI is not installed!");
      console.error("\nInstall it with:");
      console.error("   npm install -g aws-cdk");
      return false;
    }

    // Check AWS credentials
    console.log("\n🔍 Checking AWS credentials...");
    try {
      const identity = execSync("aws sts get-caller-identity", { encoding: "utf8" });
      const identityJson = JSON.parse(identity);
      console.log(`   ✓ Authenticated as: ${identityJson.Arn}`);
      console.log(`   Account: ${identityJson.Account}`);
    } catch (error) {
      console.error("\n❌ AWS credentials not configured!");
      console.error("\nConfigure them with:");
      console.error("   aws configure");
      return false;
    }

    // Install dependencies
    console.log("\n📦 Installing dependencies...");
    execSync("npm install", {
      cwd: cdkDir,
      stdio: "inherit",
    });
    console.log("   ✓ Dependencies installed");

    // Build TypeScript
    console.log("\n🔨 Building TypeScript...");
    execSync("npm run build", {
      cwd: cdkDir,
      stdio: "inherit",
    });
    console.log("   ✓ Build completed");

    // CDK synth (validate the stack)
    console.log("\n🔍 Synthesizing CloudFormation...");
    execSync("npx cdk synth", {
      cwd: cdkDir,
      stdio: "inherit",
    });
    console.log("   ✓ Synthesis successful");

    // Ask for bootstrap confirmation
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const shouldBootstrap = await rl.question(
      "\n🔧 Bootstrap CDK environment (required for first deployment)? (yes/no): "
    );

    if (shouldBootstrap.trim().toLowerCase() === "yes" || shouldBootstrap.trim().toLowerCase() === "y") {
      console.log("\n🔧 Bootstrapping CDK environment...");
      const bootstrapCmd = metadata.region
        ? `npx cdk bootstrap aws://unknown-account/${metadata.region}`
        : "npx cdk bootstrap";

      execSync(bootstrapCmd, {
        cwd: cdkDir,
        stdio: "inherit",
      });
      console.log("   ✓ Bootstrap completed");
    }

    // Show what will be deployed
    console.log("\n📋 Generating deployment diff...");
    try {
      execSync("npx cdk diff", {
        cwd: cdkDir,
        stdio: "inherit",
      });
    } catch (error) {
      // diff returns non-zero if there are changes, which is expected
      if (error.status !== 0 && error.status !== 1) {
        throw error;
      }
    }

    // Final deployment confirmation
    const shouldDeploy = await rl.question(
      "\n🚀 Deploy this stack to AWS? (yes/no): "
    );
    rl.close();

    if (shouldDeploy.trim().toLowerCase() !== "yes" && shouldDeploy.trim().toLowerCase() !== "y") {
      console.log("\n⏸️  Deployment cancelled by user");
      return false;
    }

    // Deploy!
    console.log("\n🚀 Deploying stack to AWS...");
    console.log("   This may take several minutes...\n");

    execSync("npx cdk deploy --require-approval never", {
      cwd: cdkDir,
      stdio: "inherit",
    });

    console.log("\n✅ Deployment completed successfully!");

    // Show outputs
    console.log("\n📤 Fetching stack outputs...");
    try {
      const outputs = execSync("npx cdk outputs --json", {
        cwd: cdkDir,
        encoding: "utf8",
      });
      const outputsJson = JSON.parse(outputs);
      console.log("\nStack Outputs:");
      console.log(JSON.stringify(outputsJson, null, 2));
    } catch (error) {
      console.log("   (No outputs defined)");
    }

    return true;
  } catch (error) {
    console.error("\n❌ Deployment failed!");
    console.error(error.message);
    return false;
  }
}

/**
 * Generate a README with deployment instructions
 */
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

## Useful Commands

- \`npm run build\` - compile TypeScript to JavaScript
- \`npm run watch\` - watch for changes and compile
- \`cdk synth\` - synthesize CloudFormation template
- \`cdk diff\` - compare deployed stack with current state
- \`cdk deploy\` - deploy this stack to AWS
- \`cdk destroy\` - remove this stack from AWS

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
