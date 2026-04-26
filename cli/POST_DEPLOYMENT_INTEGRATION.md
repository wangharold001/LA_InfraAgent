# Post-Deployment Integration

## New Simplified Workflow

Integration now happens **AFTER deployment**, so you can reference the **actual deployed resources** instead of guessing.

## Complete Flow

```
1. Design Architecture      → AI generates infrastructure diagram
2. Review & Approve         → You edit/approve in browser
3. Generate CDK Code        → AI writes TypeScript CDK project
4. Deploy to AWS            → `cdk deploy` creates resources
5. Integrate into Codebase  → AI adds SDK calls with REAL ARNs/names ← NEW!
6. Set Environment Vars     → Auto-set on Railway/Vercel/.env
```

## Why Post-Deployment?

### Before (Phase 2.5 - Pre-Deployment)
❌ Agent **guesses** what resources will be named
❌ Uses placeholder env vars like `S3_BUCKET_NAME` (unknown value)
❌ Can't reference actual ARNs until after deployment
❌ Integration might fail if deployment creates different names

### After (Phase 5 - Post-Deployment)
✅ Agent uses **actual deployed resources**
✅ Real ARNs, bucket names, queue URLs from CloudFormation outputs
✅ Integration code references exact resources that exist
✅ Environment variables have real values immediately

## Example

### After Deployment Succeeds

```
🎉 SUCCESS! Your infrastructure is now live on AWS!

Stack outputs:
  - MyBucketName: cramifystack-uploads-bucket-418272788244
  - NotificationTopicArn: arn:aws:sns:us-east-1:418272788244:cramifystack-notifications
  - ProcessorFunctionArn: arn:aws:lambda:us-east-1:418272788244:function:cramifystack-processor

🔗 Would you like me to integrate this deployed infrastructure into your codebase?
   (I'll add AWS SDK calls with the actual deployed resource ARNs/names)
   [yes/no] (default: no):
```

### You Say "Yes"

```
📍 PHASE 5: Post-Deployment Codebase Integration

🔍 Analyzing codebase for integration with deployed resources...

   📂 Scanning directory: /Users/you/project

   ✓ Found 12 source files:
     - app.py
     - routes/upload.py
     - services/notifier.py
     - requirements.txt
     ...

📋 INTEGRATION PLAN

Python Flask project detected.

📝 FILES TO BE MODIFIED:

  📄 routes/upload.py
     Upload files to S3 using deployed bucket
     Env vars: S3_BUCKET_NAME, AWS_REGION

  📄 services/notifier.py
     Send notifications using deployed SNS topic
     Env vars: SNS_TOPIC_ARN, AWS_REGION

📦 DEPENDENCIES TO BE ADDED:

  📄 requirements.txt
     boto3, python-dotenv

⚙️  Applying changes to your codebase...

   ✏️  Modifying routes/upload.py...
      ✓ Modified

   ✏️  Modifying services/notifier.py...
      ✓ Modified

   📦 Updating requirements.txt...
      ✓ Updated

📊 Results: 3 succeeded, 0 failed

🔍 Review the changes:

diff --git a/routes/upload.py b/routes/upload.py
index 1234567..abcdefg 100644
--- a/routes/upload.py
+++ b/routes/upload.py
@@ -1,5 +1,8 @@
 from flask import Blueprint, request, jsonify
 from werkzeug.utils import secure_filename
+import boto3
+import os
+
+s3_client = boto3.client('s3', region_name=os.getenv('AWS_REGION'))

 @app.route('/upload', methods=['POST'])
 def upload_file():
     file = request.files.get('file')
     if not file:
         return jsonify({'error': 'No file provided'}), 400

     filename = secure_filename(file.filename)
+
+    # Upload to deployed S3 bucket
+    s3_client.put_object(
+        Bucket=os.getenv('S3_BUCKET_NAME'),  # Uses actual deployed bucket!
+        Key=filename,
+        Body=file.read()
+    )

     return jsonify({'message': 'File uploaded', 'filename': filename}), 200

diff --git a/requirements.txt b/requirements.txt
index 2345678..bcdefgh 100644
--- a/requirements.txt
+++ b/requirements.txt
@@ -1,3 +1,5 @@
 flask==2.3.0
 werkzeug==2.3.0
+boto3==1.34.0
+python-dotenv==1.0.0

❓ Keep these changes? [yes/no] (default: yes):
```

### You Say "Yes" Again

```
✅ Changes kept! Proceeding to set environment variables.

🌐 POST-DEPLOYMENT: ENVIRONMENT VARIABLE SETUP

📤 Reading CDK stack outputs...

📋 Stack Outputs:
   MyBucketName: cramifystack-uploads-bucket-418272788244
   NotificationTopicArn: arn:aws:sns:us-east-1:418272788244:cramifystack-notifications

🔧 Mapped Environment Variables:
   S3_BUCKET_NAME=cramifystack-uploads-bucket-418272788244
   SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:cramifystack-notifications
   AWS_REGION=us-east-1

🎯 Detected Platforms: railway, local

🚂 Setting environment variables on Railway...
   ✓ Railway: S3_BUCKET_NAME=cramifystack-uploads-bucket-418272788244
   ✓ Railway: SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:cramifystack-notifications
   ✓ Railway: AWS_REGION=us-east-1

📝 Writing environment variables to .env file...
   ✓ S3_BUCKET_NAME=cramifystack-uploads-bucket-418272788244
   ✓ SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:cramifystack-notifications
   ✓ AWS_REGION=us-east-1

✅ Environment variable setup complete!

🎉 Your infrastructure is deployed AND integrated into your codebase!
```

## What Gets Integrated

The agent looks at your architecture diagram and identifies where to add AWS SDK calls:

### S3 Bucket
**Where:** File upload routes/functions
**Code Added:**
```python
import boto3
s3_client = boto3.client('s3', region_name=os.getenv('AWS_REGION'))

s3_client.put_object(
    Bucket=os.getenv('S3_BUCKET_NAME'),  # Actual: cramifystack-uploads-bucket-418272788244
    Key=filename,
    Body=file_data
)
```

### SNS Topic
**Where:** Notification services
**Code Added:**
```python
import boto3
sns_client = boto3.client('sns', region_name=os.getenv('AWS_REGION'))

sns_client.publish(
    TopicArn=os.getenv('SNS_TOPIC_ARN'),  # Actual: arn:aws:sns:us-east-1:...
    Message='File uploaded successfully'
)
```

### DynamoDB Table
**Where:** Database access functions
**Code Added:**
```python
import boto3
dynamodb = boto3.resource('dynamodb', region_name=os.getenv('AWS_REGION'))
table = dynamodb.Table(os.getenv('DYNAMODB_TABLE_NAME'))  # Actual: cramifystack-users

table.put_item(Item={'id': '123', 'name': 'John'})
```

## Benefits

### 1. Real Resource References
Environment variables contain **actual** deployed values:
```bash
S3_BUCKET_NAME=cramifystack-uploads-bucket-418272788244  # Real bucket name!
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:topic   # Real ARN!
```

Not placeholders or guesses.

### 2. Immediate Testing
After integration:
```bash
# Your code can immediately use the deployed resources
python app.py

# The env vars are already set on Railway/Vercel
git push  # Deploys with correct env vars
```

### 3. No Sync Issues
Pre-deployment integration had a risk:
- Agent guesses: `my-app-bucket`
- CDK deploys: `MyAppStack-Bucket-A1B2C3D4` (different!)
- Code breaks because names don't match

Post-deployment integration uses **exact** names from deployment.

### 4. Platform-Specific Deployment
If your code is on Railway:
```bash
✓ Railway: S3_BUCKET_NAME=actual-bucket-name
```

If on Vercel:
```bash
✓ Vercel: S3_BUCKET_NAME=actual-bucket-name (production, preview, development)
```

If local development:
```bash
✓ .env: S3_BUCKET_NAME=actual-bucket-name
```

## If You Say "No"

```
🔗 Would you like me to integrate this deployed infrastructure into your codebase?
   [yes/no] (default: no): no

⏸️  Skipping integration. You can manually integrate using these outputs:

Stack Outputs:
  - MyBucketName: cramifystack-uploads-bucket-418272788244
  - NotificationTopicArn: arn:aws:sns:us-east-1:418272788244:cramifystack-notifications

Set these as environment variables in your application:
  S3_BUCKET_NAME=cramifystack-uploads-bucket-418272788244
  SNS_TOPIC_ARN=arn:aws:sns:us-east-1:418272788244:cramifystack-notifications
```

You still see the values and can integrate manually.

## Reverting Integration

If you approve integration but then want to undo it:

```bash
❓ Keep these changes? [yes/no] (default: yes): no

🔄 Reverting changes...
   ✓ Reverted routes/upload.py
   ✓ Reverted services/notifier.py
   ✓ Reverted requirements.txt

✅ Changes reverted. Infrastructure remains deployed.
```

The deployed AWS resources stay - only the code changes are reverted.

## Manual Integration

If you skip integration or it fails, you can still use the resources manually:

### 1. Get Stack Outputs
```bash
cd cdk-infrastructure
npx cdk deploy --outputs-file outputs.json
cat outputs.json
```

### 2. Set Environment Variables
```bash
# Railway
railway variables set S3_BUCKET_NAME=your-bucket-name
railway variables set SNS_TOPIC_ARN=your-topic-arn

# Vercel
vercel env add S3_BUCKET_NAME production
vercel env add SNS_TOPIC_ARN production

# Local
echo "S3_BUCKET_NAME=your-bucket-name" >> .env
echo "SNS_TOPIC_ARN=your-topic-arn" >> .env
```

### 3. Add SDK Code
Use the deployed resource values in your application code.

## Summary

**Old Flow:** Design → Approve → **Integrate (guess)** → Deploy → Set env vars
**New Flow:** Design → Approve → Deploy → **Integrate (actual values)** → Set env vars

Integration happens **after** deployment so the agent can reference **real** deployed resources!
