# Troubleshooting InfraAgent

## Error: "Resource already exists"

### Problem
```
Resource handler returned message: "Topic creation failed because
the topic already exists"
```

This happens when:
1. A previous deployment created the resource
2. The stack was deleted but resources weren't cleaned up
3. You're redeploying with the same resource names

### Solution 1: Delete the Existing Stack Completely

```bash
cd cdk-infrastructure

# Delete the entire stack (this will remove all resources)
npx cdk destroy

# If destroy fails, force delete from AWS Console:
# 1. Go to CloudFormation console
# 2. Find your stack
# 3. Click "Delete"
# 4. If delete fails, click "Delete stack" and check "Retain resources"

# Then clean up orphaned resources manually:
aws sns list-topics
aws sns delete-topic --topic-arn arn:aws:sns:REGION:ACCOUNT:TOPIC-NAME
```

### Solution 2: Delete Orphaned Resources

If the stack is already deleted but resources remain:

```bash
# List SNS topics
aws sns list-topics

# Delete specific topic
aws sns delete-topic --topic-arn arn:aws:sns:us-east-1:123456789:EmailNotificationTopic

# List SQS queues
aws sqs list-queues

# Delete specific queue
aws sqs delete-queue --queue-url https://sqs.us-east-1.amazonaws.com/123456789/MyQueue

# List S3 buckets
aws s3 ls

# Delete bucket and contents
aws s3 rb s3://bucket-name --force

# List Lambda functions
aws lambda list-functions

# Delete function
aws lambda delete-function --function-name function-name
```

### Solution 3: Regenerate with Unique Names

The latest version of InfraAgent now generates resources with unique names:

```bash
# Regenerate your infrastructure
cd /path/to/LA_InfraAgent/cli
rm -rf cdk-infrastructure
node bin/infra-agent.js

# New resources will have unique names like:
# InfrastructureStack-email-notification-topic
# InfrastructureStack-file-processor-function
```

### Prevention: How New Code Avoids This

The updated CDK generator now creates resources with stack-scoped names:

```typescript
// OLD (causes conflicts):
const topic = new sns.Topic(this, 'EmailNotificationTopic');

// NEW (unique names):
const topic = new sns.Topic(this, 'EmailNotificationTopic', {
  topicName: `${Stack.of(this).stackName}-email-notification-topic`
});
```

## Error: Invalid JSON in package.json/cdk.json

### Problem
```
SyntaxError: Unexpected token / in JSON
```

### Solution
The agent now validates and auto-fixes JSON files. If you still see this:

```bash
# Manually check JSON files
cd cdk-infrastructure
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"
node -e "JSON.parse(require('fs').readFileSync('cdk.json', 'utf8'))"

# If invalid, regenerate:
cd ..
rm -rf cdk-infrastructure
node bin/infra-agent.js
```

## Error: TypeScript compilation failed

### Problem
```
error TS2561: Object literal may only specify known properties
```

### Solution
This is fixed in the latest version. The agent now:
- Uses correct property names (e.g., `logRemovalPolicy` for Lambda)
- Only includes properties supported by each resource type
- Validates against CDK documentation

Regenerate your infrastructure:
```bash
rm -rf cdk-infrastructure
node bin/infra-agent.js
```

## Error: CDK bootstrap required

### Problem
```
SSM parameter /cdk-bootstrap/hnb659fds/version not found
```

### Solution
```bash
cd cdk-infrastructure

# Bootstrap CDK in your account/region (one-time setup)
npx cdk bootstrap

# Or specify account and region explicitly:
npx cdk bootstrap aws://123456789012/us-east-1
```

## Error: AWS credentials not configured

### Problem
```
Unable to locate credentials
```

### Solution
```bash
# Option 1: Configure AWS CLI
aws configure

# Option 2: Set environment variables
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_DEFAULT_REGION=us-east-1

# Option 3: Use AWS profile
export AWS_PROFILE=your-profile-name
```

## Best Practices to Avoid Issues

### 1. Always Clean Up Failed Deployments

```bash
# If deployment fails:
npx cdk destroy

# Verify resources are deleted:
aws cloudformation list-stacks --stack-status-filter DELETE_COMPLETE
```

### 2. Use Unique Stack Names

When running the agent, use descriptive, unique names:
```
What infrastructure would you like to build?
> S3 email notifier for project XYZ
```

This creates unique stack names like `S3EmailNotifierForProjectXyzStack`.

### 3. Check What Exists Before Deploying

```bash
# List existing stacks
aws cloudformation list-stacks

# List SNS topics
aws sns list-topics

# List S3 buckets
aws s3 ls
```

### 4. Use Different Regions for Testing

If you want to test without affecting existing resources:
```bash
export AWS_DEFAULT_REGION=us-west-2
node bin/infra-agent.js
```

## Getting Help

If you're still stuck:

1. Check CloudFormation events:
```bash
aws cloudformation describe-stack-events --stack-name YourStackName
```

2. View CDK diff before deploying:
```bash
cd cdk-infrastructure
npx cdk diff
```

3. Use CDK doctor:
```bash
npx cdk doctor
```

4. Check the generated code:
```bash
cat lib/*-stack.ts
```
