import { execSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Environment Variable Setter Module
 *
 * After CDK deployment, this module:
 * 1. Reads CDK stack outputs (ARNs, URLs, names, etc.)
 * 2. Detects deployment platform (Railway, Vercel, local)
 * 3. Sets environment variables on the appropriate platform
 */

/**
 * Platform detection results
 */
const PLATFORMS = {
  RAILWAY: "railway",
  VERCEL: "vercel",
  LOCAL: "local",
};

/**
 * Detect which platform(s) the codebase is deployed on
 * @param {string} repoPath - Path to the repository
 * @returns {Array<string>} - List of detected platforms
 */
export function detectPlatforms(repoPath) {
  const platforms = [];

  // Check for Railway
  if (fs.existsSync(path.join(repoPath, "railway.json")) ||
      fs.existsSync(path.join(repoPath, "railway.toml"))) {
    platforms.push(PLATFORMS.RAILWAY);
  }

  // Check for Vercel
  if (fs.existsSync(path.join(repoPath, "vercel.json")) ||
      fs.existsSync(path.join(repoPath, ".vercel"))) {
    platforms.push(PLATFORMS.VERCEL);
  }

  // Check if Railway CLI is available
  try {
    execSync("railway --version", { stdio: "ignore" });
    if (!platforms.includes(PLATFORMS.RAILWAY)) {
      platforms.push(PLATFORMS.RAILWAY);
    }
  } catch {
    // Railway CLI not available
  }

  // Check if Vercel CLI is available
  try {
    execSync("vercel --version", { stdio: "ignore" });
    if (!platforms.includes(PLATFORMS.VERCEL)) {
      platforms.push(PLATFORMS.VERCEL);
    }
  } catch {
    // Vercel CLI not available
  }

  // Always support local .env as fallback
  if (platforms.length === 0 || platforms.includes(PLATFORMS.LOCAL)) {
    platforms.push(PLATFORMS.LOCAL);
  }

  return platforms;
}

/**
 * Get CDK stack outputs
 * @param {string} cdkOutputDir - Path to CDK project directory
 * @param {string} stackName - Name of the deployed stack
 * @returns {object} - Stack outputs as key-value pairs
 */
export function getCDKStackOutputs(cdkOutputDir, stackName) {
  console.log(`\n📤 Reading CDK stack outputs for ${stackName}...\n`);

  try {
    // Read cdk-outputs.json if it exists
    const outputsFile = path.join(cdkOutputDir, "cdk-outputs.json");
    if (fs.existsSync(outputsFile)) {
      const outputs = JSON.parse(fs.readFileSync(outputsFile, "utf8"));
      return outputs[stackName] || {};
    }

    // Fallback: Query AWS CloudFormation
    const result = execSync(
      `aws cloudformation describe-stacks --stack-name "${stackName}" --query "Stacks[0].Outputs" --output json`,
      { encoding: "utf8", cwd: cdkOutputDir }
    );

    const cloudFormationOutputs = JSON.parse(result);
    const outputs = {};

    for (const output of cloudFormationOutputs) {
      outputs[output.OutputKey] = output.OutputValue;
    }

    return outputs;
  } catch (error) {
    console.error(`   ❌ Error reading stack outputs: ${error.message}`);
    return {};
  }
}

/**
 * Map CDK outputs to environment variable names
 * @param {object} stackOutputs - Raw CDK stack outputs
 * @param {object} architecture - Architecture diagram for context
 * @returns {object} - Environment variables with standardized names
 */
export function mapOutputsToEnvVars(stackOutputs, architecture) {
  const envVars = {};

  // Map each output to a standardized env var name
  for (const [key, value] of Object.entries(stackOutputs)) {
    // Try to detect resource type from key name
    const keyLower = key.toLowerCase();

    if (keyLower.includes("bucket")) {
      // S3 bucket
      if (keyLower.includes("name")) {
        envVars.S3_BUCKET_NAME = value;
      } else if (keyLower.includes("arn")) {
        envVars.S3_BUCKET_ARN = value;
      }
    } else if (keyLower.includes("table")) {
      // DynamoDB table
      if (keyLower.includes("name")) {
        envVars.DYNAMODB_TABLE_NAME = value;
      } else if (keyLower.includes("arn")) {
        envVars.DYNAMODB_TABLE_ARN = value;
      }
    } else if (keyLower.includes("topic")) {
      // SNS topic
      if (keyLower.includes("arn")) {
        envVars.SNS_TOPIC_ARN = value;
      }
    } else if (keyLower.includes("queue")) {
      // SQS queue
      if (keyLower.includes("url")) {
        envVars.SQS_QUEUE_URL = value;
      } else if (keyLower.includes("arn")) {
        envVars.SQS_QUEUE_ARN = value;
      }
    } else if (keyLower.includes("function")) {
      // Lambda function
      if (keyLower.includes("arn")) {
        envVars.LAMBDA_FUNCTION_ARN = value;
      } else if (keyLower.includes("name")) {
        envVars.LAMBDA_FUNCTION_NAME = value;
      }
    } else if (keyLower.includes("api") || keyLower.includes("url")) {
      // API Gateway
      envVars.API_GATEWAY_URL = value;
    } else if (keyLower.includes("endpoint")) {
      // RDS or other endpoint
      if (keyLower.includes("rds") || keyLower.includes("database")) {
        envVars.RDS_ENDPOINT = value;
      }
    } else if (keyLower.includes("role")) {
      // IAM role
      if (keyLower.includes("arn")) {
        envVars.IAM_ROLE_ARN = value;
      }
    } else {
      // Generic mapping - use the key as-is but uppercase
      const envVarName = key.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
      envVars[envVarName] = value;
    }
  }

  // Always include AWS region
  if (architecture.metadata && architecture.metadata.region) {
    envVars.AWS_REGION = architecture.metadata.region;
  }

  return envVars;
}

/**
 * Set environment variables on Railway
 * @param {object} envVars - Environment variables to set
 * @param {string} projectName - Optional Railway project name
 */
export async function setRailwayEnvVars(envVars, projectName = null) {
  console.log("\n🚂 Setting environment variables on Railway...\n");

  try {
    // Check if Railway CLI is available
    execSync("railway --version", { stdio: "ignore" });

    // Link to project if name provided
    if (projectName) {
      console.log(`   🔗 Linking to Railway project: ${projectName}`);
      execSync(`railway link ${projectName}`, { stdio: "inherit" });
    }

    // Set each environment variable
    for (const [key, value] of Object.entries(envVars)) {
      console.log(`   ✓ Railway: ${key}=${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`);
      execSync(`railway variables set ${key}="${value}"`, { stdio: "ignore" });
    }

    console.log("\n✅ Railway environment variables set!\n");
  } catch (error) {
    console.error(`   ❌ Error setting Railway env vars: ${error.message}`);
    console.error("   💡 Make sure Railway CLI is installed: npm install -g @railway/cli");
    console.error("   💡 And that you're logged in: railway login");
  }
}

/**
 * Set environment variables on Vercel
 * @param {object} envVars - Environment variables to set
 * @param {string} projectName - Optional Vercel project name
 */
export async function setVercelEnvVars(envVars, projectName = null) {
  console.log("\n▲ Setting environment variables on Vercel...\n");

  try {
    // Check if Vercel CLI is available
    execSync("vercel --version", { stdio: "ignore" });

    // Link to project if name provided
    if (projectName) {
      console.log(`   🔗 Linking to Vercel project: ${projectName}`);
      execSync(`vercel link --yes --project=${projectName}`, { stdio: "inherit" });
    }

    // Set each environment variable for all environments
    for (const [key, value] of Object.entries(envVars)) {
      console.log(`   ✓ Vercel: ${key}=${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`);

      // Set for production, preview, and development
      execSync(
        `vercel env add ${key} production preview development --force <<EOF\\n${value}\\nEOF`,
        { stdio: "ignore", shell: "/bin/bash" }
      );
    }

    console.log("\n✅ Vercel environment variables set!\n");
  } catch (error) {
    console.error(`   ❌ Error setting Vercel env vars: ${error.message}`);
    console.error("   💡 Make sure Vercel CLI is installed: npm install -g vercel");
    console.error("   💡 And that you're logged in: vercel login");
  }
}

/**
 * Write environment variables to local .env file
 * @param {object} envVars - Environment variables to set
 * @param {string} repoPath - Path to repository
 */
export function writeLocalEnvFile(envVars, repoPath) {
  console.log("\n📝 Writing environment variables to .env file...\n");

  const envFilePath = path.join(repoPath, ".env");
  let envContent = "";

  // Read existing .env if it exists
  if (fs.existsSync(envFilePath)) {
    envContent = fs.readFileSync(envFilePath, "utf8");
  }

  // Add header
  const header = `
# AWS Infrastructure Environment Variables
# Generated by InfraAgent on ${new Date().toISOString()}
`;
  envContent += header;

  // Add each environment variable
  for (const [key, value] of Object.entries(envVars)) {
    console.log(`   ✓ ${key}=${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`);
    // Quote values to handle special characters in ARNs, URLs, etc.
    envContent += `${key}="${value}"\n`;
  }

  // Write .env file
  fs.writeFileSync(envFilePath, envContent, "utf8");

  console.log(`\n✅ Environment variables written to ${envFilePath}\n`);
  console.log("   💡 Make sure to add .env to your .gitignore!");

  // Check if .env is in .gitignore
  const gitignorePath = path.join(repoPath, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf8");
    if (!gitignore.includes(".env")) {
      console.log("   ⚠️  .env is not in .gitignore - consider adding it!");
    }
  }
}

/**
 * Set environment variables on all detected platforms
 * @param {string} cdkOutputDir - Path to CDK project
 * @param {string} stackName - Stack name
 * @param {object} architecture - Architecture diagram
 * @param {string} repoPath - Path to repository
 */
export async function setEnvironmentVariables(cdkOutputDir, stackName, architecture, repoPath) {
  console.log("\n" + "=".repeat(80));
  console.log("🌐 POST-DEPLOYMENT: ENVIRONMENT VARIABLE SETUP");
  console.log("=".repeat(80));

  // Get stack outputs
  const stackOutputs = getCDKStackOutputs(cdkOutputDir, stackName);

  if (Object.keys(stackOutputs).length === 0) {
    console.log("\n⚠️  No stack outputs found. Skipping environment variable setup.\n");
    return;
  }

  console.log("\n📋 Stack Outputs:");
  for (const [key, value] of Object.entries(stackOutputs)) {
    console.log(`   ${key}: ${value}`);
  }

  // Map to environment variable names
  const envVars = mapOutputsToEnvVars(stackOutputs, architecture);

  console.log("\n🔧 Mapped Environment Variables:");
  for (const [key, value] of Object.entries(envVars)) {
    console.log(`   ${key}=${value.substring(0, 50)}${value.length > 50 ? "..." : ""}`);
  }

  // Detect platforms
  const platforms = detectPlatforms(repoPath);

  console.log(`\n🎯 Detected Platforms: ${platforms.join(", ")}\n`);

  // Set env vars on each platform
  for (const platform of platforms) {
    if (platform === PLATFORMS.RAILWAY) {
      await setRailwayEnvVars(envVars);
    } else if (platform === PLATFORMS.VERCEL) {
      await setVercelEnvVars(envVars);
    } else if (platform === PLATFORMS.LOCAL) {
      writeLocalEnvFile(envVars, repoPath);
    }
  }

  console.log("=".repeat(80));
  console.log("✅ Environment variable setup complete!");
  console.log("=".repeat(80));
}

/**
 * Generate example environment variable usage code
 * @param {object} envVars - Environment variables
 * @param {string} language - Programming language (nodejs, python, go, java)
 * @returns {string} - Example code snippet
 */
export function generateEnvVarUsageExample(envVars, language = "nodejs") {
  const examples = {
    nodejs: `// Load environment variables
require('dotenv').config();

// Access AWS resources using environment variables
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const snsClient = new SNSClient({ region: process.env.AWS_REGION });

// Upload to S3
await s3Client.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET_NAME,
  Key: 'example.txt',
  Body: 'Hello World',
}));

// Send SNS notification
await snsClient.send(new PublishCommand({
  TopicArn: process.env.SNS_TOPIC_ARN,
  Message: 'File uploaded successfully',
}));`,

    python: `# Load environment variables
import os
from dotenv import load_dotenv
import boto3

load_dotenv()

# Access AWS resources using environment variables
s3_client = boto3.client('s3', region_name=os.getenv('AWS_REGION'))
sns_client = boto3.client('sns', region_name=os.getenv('AWS_REGION'))

# Upload to S3
s3_client.put_object(
    Bucket=os.getenv('S3_BUCKET_NAME'),
    Key='example.txt',
    Body=b'Hello World'
)

# Send SNS notification
sns_client.publish(
    TopicArn=os.getenv('SNS_TOPIC_ARN'),
    Message='File uploaded successfully'
)`,

    go: `// Load environment variables
package main

import (
    "os"
    "github.com/joho/godotenv"
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/aws/session"
    "github.com/aws/aws-sdk-go/service/s3"
    "github.com/aws/aws-sdk-go/service/sns"
)

func main() {
    godotenv.Load()

    sess := session.Must(session.NewSession(&aws.Config{
        Region: aws.String(os.Getenv("AWS_REGION")),
    }))

    // Upload to S3
    s3Svc := s3.New(sess)
    s3Svc.PutObject(&s3.PutObjectInput{
        Bucket: aws.String(os.Getenv("S3_BUCKET_NAME")),
        Key:    aws.String("example.txt"),
        Body:   strings.NewReader("Hello World"),
    })

    // Send SNS notification
    snsSvc := sns.New(sess)
    snsSvc.Publish(&sns.PublishInput{
        TopicArn: aws.String(os.Getenv("SNS_TOPIC_ARN")),
        Message:  aws.String("File uploaded successfully"),
    })
}`,
  };

  return examples[language] || examples.nodejs;
}
