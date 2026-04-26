# Codebase Integration Feature

> **⚠️  NOTE:** This document describes the old pre-deployment integration approach.
>
> **The current implementation uses POST-deployment integration** - see [POST_DEPLOYMENT_INTEGRATION.md](./POST_DEPLOYMENT_INTEGRATION.md) for the updated workflow.

## Overview (OLD - Pre-Deployment Approach)

InfraAgent previously supported pre-deployment integration - after generating your AWS architecture but before deployment, the tool would analyze your existing code and integrate AWS SDK calls.

## How It Works

The complete workflow now includes an optional **Phase 2.5: Codebase Integration** between architecture approval and CDK generation:

### Full Pipeline

1. **Phase 1**: Architecture Design (AI generates infrastructure diagram)
2. **Phase 2**: Review & Approval (You edit and approve the diagram)
3. **Phase 2.5** *(optional)*: **Codebase Integration** ← NEW!
4. **Phase 3**: CDK Code Generation
5. **Phase 4**: Deployment
6. **Phase 5**: Post-Deployment Environment Variable Setup ← NEW!

## Phase 2.5: Codebase Integration

After you approve your architecture diagram, InfraAgent will ask:

```
🔗 Would you like me to integrate this infrastructure into your existing codebase?
   (I'll analyze your code, generate SDK calls with env vars, and update dependencies)
   [yes/no] (default: no):
```

If you answer **yes**, the agent will:

### 1. Analyze Your Codebase

The agent reads your source files and detects:
- Programming language (Node.js, Python, Go, Java)
- Framework (Express, Flask, etc.)
- Project structure
- Existing AWS SDK usage (if any)

### 2. Map Edges to Code

For each connection in your architecture diagram, the agent identifies:
- **Which file** should use this AWS service
- **Which function/class/method** needs the integration code
- **What SDK calls** to add

Example mapping:
```
Architecture edge: FileProcessor (Lambda) → NotificationTopic (SNS)
Maps to: src/services/file-processor.js, function processFile()
Action: Add SNS publish call after file processing
```

### 3. Generate Integration Code

The agent generates SDK code that uses **ENVIRONMENT VARIABLES** for all AWS resources:

#### Node.js Example:
```javascript
// Auto-generated integration code
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const snsClient = new SNSClient({ region: process.env.AWS_REGION });

await snsClient.send(new PublishCommand({
  TopicArn: process.env.SNS_TOPIC_ARN,  // ← Environment variable
  Message: `File processed: ${fileName}`,
}));
```

#### Python Example:
```python
# Auto-generated integration code
import os
import boto3

sns_client = boto3.client('sns', region_name=os.getenv('AWS_REGION'))

sns_client.publish(
    TopicArn=os.getenv('SNS_TOPIC_ARN'),  # ← Environment variable
    Message=f'File processed: {file_name}'
)
```

### 4. Update Dependencies

The agent automatically adds required AWS SDK packages:

**Node.js** (`package.json`):
```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.0.0",
    "@aws-sdk/client-sns": "^3.0.0",
    "dotenv": "^16.0.0"
  }
}
```

**Python** (`requirements.txt`):
```
boto3==1.34.0
python-dotenv==1.0.0
```

### 5. Show Diff and Get Approval

Before applying changes, the agent shows you:
- All proposed code changes
- Which files will be modified
- What dependencies will be added
- What environment variables are required

Example output:
```
📋 INTEGRATION PLAN

📝 CODE CHANGES:

  📄 src/services/file-processor.js (in function processFile)
     Send SNS notification after file processing
     Env vars: SNS_TOPIC_ARN, AWS_REGION

  [code snippet shown here]

📦 DEPENDENCY UPDATES:

  📄 package.json
     Add: @aws-sdk/client-sns, dotenv

❓ Do you approve these changes? [yes/no]:
```

### 6. Apply Integration

If you approve, the agent:
- Inserts the SDK code into your files
- Updates dependency files
- Creates/updates `.env` template with required variables

## Phase 5: Post-Deployment Environment Variable Setup

After successful deployment, if you opted for codebase integration, the agent automatically:

### 1. Reads CDK Stack Outputs

Extracts all resource identifiers from the deployed stack:
- S3 bucket names and ARNs
- SNS topic ARNs
- SQS queue URLs
- DynamoDB table names
- Lambda function ARNs
- API Gateway URLs
- RDS endpoints

### 2. Detects Deployment Platform

Automatically detects where your code is deployed:
- **Railway** (checks for `railway.json` or Railway CLI)
- **Vercel** (checks for `vercel.json` or Vercel CLI)
- **Local** (always available as fallback)

### 3. Sets Environment Variables

#### Railway:
```bash
🚂 Setting environment variables on Railway...

   ✓ Railway: S3_BUCKET_NAME=mystack-bucket-418272788244
   ✓ Railway: SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418...
   ✓ Railway: AWS_REGION=us-east-1

✅ Railway environment variables set!
```

Uses Railway CLI commands:
```bash
railway variables set S3_BUCKET_NAME="mystack-bucket-..."
railway variables set SNS_TOPIC_ARN="arn:aws:sns:..."
```

#### Vercel:
```bash
▲ Setting environment variables on Vercel...

   ✓ Vercel: S3_BUCKET_NAME=mystack-bucket-418272788244
   ✓ Vercel: SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418...

✅ Vercel environment variables set!
```

Sets variables for all environments (production, preview, development):
```bash
vercel env add S3_BUCKET_NAME production preview development
```

#### Local .env:
```bash
📝 Writing environment variables to .env file...

   ✓ S3_BUCKET_NAME=mystack-bucket-418272788244
   ✓ SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:topic
   ✓ AWS_REGION=us-east-1

✅ Environment variables written to /path/to/project/.env
```

Creates/updates `.env`:
```env
# AWS Infrastructure Environment Variables
# Generated by InfraAgent on 2026-04-25T14:30:00Z

S3_BUCKET_NAME=mystack-bucket-418272788244
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:mystack-topic
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/418272788244/mystack-queue
DYNAMODB_TABLE_NAME=mystack-table
AWS_REGION=us-east-1
```

## Graph Ownership Rules

The integration respects different node types:

### External Nodes (Not Managed by CDK)
- **Examples**: Railway services, Vercel deployments, third-party APIs
- **Integration**: Referenced by endpoint/ARN only
- **Never created or modified** by CDK

### Managed Nodes (Created by CDK)
- **Examples**: S3 buckets, Lambda functions, DynamoDB tables
- **Integration**: SDK calls use environment variables
- **Resolved post-deployment** with actual ARNs/names/URLs

## Environment Variable Naming Conventions

The agent uses consistent, predictable names:

| Resource Type | Environment Variables |
|---------------|----------------------|
| S3 Bucket | `S3_BUCKET_NAME`, `S3_BUCKET_ARN` |
| DynamoDB Table | `DYNAMODB_TABLE_NAME`, `DYNAMODB_TABLE_ARN` |
| SNS Topic | `SNS_TOPIC_ARN` |
| SQS Queue | `SQS_QUEUE_URL`, `SQS_QUEUE_ARN` |
| Lambda Function | `LAMBDA_FUNCTION_ARN`, `LAMBDA_FUNCTION_NAME` |
| API Gateway | `API_GATEWAY_URL` |
| RDS Database | `RDS_ENDPOINT`, `RDS_DATABASE_NAME` |
| IAM Role | `IAM_ROLE_ARN` |

Plus `AWS_REGION` is always included.

## Benefits

1. **No Hardcoded Values**: All AWS resources referenced via environment variables
2. **Platform Agnostic**: Works with Railway, Vercel, or local development
3. **Automatic Updates**: Env vars set automatically post-deployment
4. **Safe Integration**: Shows diffs before applying any changes
5. **Minimal Changes**: Only modifies what's necessary for AWS integration
6. **Multi-Environment**: Vercel integration sets vars for prod/preview/dev

## Files Created/Modified

### New Source Files
- `cli/src/codebase-integrator.js` - Analyzes codebase and generates integration code
- `cli/src/env-setter.js` - Post-deployment environment variable management

### Modified Files
- `cli/bin/infra-agent.js` - Added Phase 2.5 integration prompt
- `cli/src/iac-pipeline.js` - Added Phase 5 post-deployment env var setup

## Prerequisites

To use this feature with cloud platforms, install their CLIs:

### Railway:
```bash
npm install -g @railway/cli
railway login
```

### Vercel:
```bash
npm install -g vercel
vercel login
```

## Example End-to-End Flow

```bash
$ node bin/infra-agent.js

# Phase 1: Architecture Design
What infrastructure would you like to build? S3 file processor with email notifications
🤖 Generating architecture...
  + node  s3          FilesBucket
  + node  lambda      FileProcessor
  + node  sns         NotificationTopic
  + edge  FilesBucket → FileProcessor (s3-notification)
  + edge  FileProcessor → NotificationTopic (sns-publish)

# Phase 2: Review & Approval in Browser
📊 Diagram opened: http://127.0.0.1:3000
Press Enter when your diagram is ready...

# Phase 2.5: Codebase Integration (NEW!)
🔗 Would you like me to integrate this infrastructure into your existing codebase?
   [yes/no]: yes

🔍 Analyzing codebase...
   📊 Codebase Analysis: Node.js project with Express framework

📋 INTEGRATION PLAN
📝 CODE CHANGES:
  📄 src/routes/upload.js (in function handleUpload)
     Upload file to S3 and send notification
     Env vars: S3_BUCKET_NAME, SNS_TOPIC_ARN, AWS_REGION

📦 DEPENDENCY UPDATES:
  📄 package.json
     Add: @aws-sdk/client-s3, @aws-sdk/client-sns, dotenv

❓ Do you approve these changes? [yes/no]: yes

✅ Codebase integration complete!

# Phase 3: CDK Code Generation
📝 Generating CDK project files...
✅ Generated 6 CDK files

# Phase 4: Deployment
Deploy to AWS now? yes
🚀 Deploying to AWS...
✅ Deployment successful!

# Phase 5: Post-Deployment Env Var Setup (NEW!)
📤 Reading CDK stack outputs...
🎯 Detected Platforms: railway, local

🚂 Setting environment variables on Railway...
   ✓ Railway: S3_BUCKET_NAME=fileprocessorstack-bucket-418272788244
   ✓ Railway: SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:...
   ✓ Railway: AWS_REGION=us-east-1

📝 Writing environment variables to .env file...
   ✓ S3_BUCKET_NAME=fileprocessorstack-bucket-418272788244
   ✓ SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:...

✅ Environment variable setup complete!

🎉 SUCCESS! Your infrastructure is now live on AWS!
```

## Configuration

No configuration needed! The feature:
- Auto-detects programming language
- Auto-detects deployment platforms
- Auto-maps resources to environment variables
- Works out of the box

## Skipping Integration

To skip codebase integration and use the traditional workflow:
- Answer **no** to the integration prompt
- Or press Enter (default is no)
- The tool will skip directly to CDK generation

## Troubleshooting

### Integration Analysis Fails
- Make sure you have source files in your repository
- Check that the agent has read access to your files

### Environment Variable Setup Fails
- **Railway**: Install Railway CLI and run `railway login`
- **Vercel**: Install Vercel CLI and run `vercel login`
- **Local**: The agent will always write `.env` as a fallback

### Integration Code Doesn't Match Your Style
- Review the diff before approving
- Reject the integration and manually add AWS SDK calls
- The env var names will still be set post-deployment

## Future Enhancements

Planned improvements:
- Support for more languages (Rust, Ruby, PHP)
- Smart merge of existing AWS SDK code
- Custom environment variable naming templates
- Integration testing generation
- Rollback capabilities

## Resources

- [AWS SDK for JavaScript](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/)
- [AWS SDK for Python (Boto3)](https://boto3.amazonaws.com/v1/documentation/api/latest/index.html)
- [Railway CLI Documentation](https://docs.railway.app/develop/cli)
- [Vercel CLI Documentation](https://vercel.com/docs/cli)
