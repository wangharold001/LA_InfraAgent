# Integration Workflow - Improved UX

## New Approach: Apply First, Review with Git Diff

Instead of printing code snippets in the terminal, the agent now:

1. **Applies changes directly to your files**
2. **Shows you the diff using git**
3. **Asks if you want to keep or revert**

This provides a much cleaner review experience!

## Updated Flow

### Old Workflow (Cluttered)
```
1. Agent analyzes codebase
2. Prints entire code snippets to terminal ❌ (messy, hard to read)
3. Asks: "Approve these changes?"
4. If yes → applies changes
```

### New Workflow (Clean)
```
1. Agent analyzes codebase
   📂 Shows directory being scanned
   ✓ Lists files found (e.g., "Found 15 source files: app.py, utils.py...")

2. Shows summary of what will change
   📝 Files to be modified
   📦 Dependencies to be added

3. Applies changes immediately

4. Shows git diff (colorized)
   🔍 You see the actual diff in your terminal

5. Asks: "Keep these changes? [yes/no]"
   - YES → Keeps changes, proceeds to CDK generation
   - NO → Reverts changes with git checkout, proceeds without integration
```

## Benefits

### ✅ Cleaner Terminal Output
No more walls of code printed to the terminal. Just a summary and the actual git diff.

### ✅ Familiar Review Process
If you use git, you're already familiar with reading diffs. This uses the same format.

### ✅ Works with Your Editor
You can:
- Review changes in your IDE/editor while the agent waits
- See syntax highlighting
- Check file-by-file

### ✅ Easy to Revert
If you don't like the changes, they're automatically reverted with `git checkout`.

### ✅ Better Error Handling
The agent now:
- Shows which directory it's scanning
- Lists all files it found
- Warns if files don't exist BEFORE applying changes
- Counts successes vs failures
- Asks if you want to continue if some integrations failed

## Example Terminal Output

```bash
🔍 Analyzing codebase for integration opportunities...

   📂 Scanning directory: /Users/you/project

   ✓ Found 8 source files:

     - app.py
     - utils/helper.py
     - config.py
     - requirements.txt
     ... and 4 more

📋 INTEGRATION PLAN
================================================================================

Node.js project with Express framework detected.

📝 FILES TO BE MODIFIED:

  📄 src/routes/upload.js
     Add S3 upload functionality after file validation
     Env vars: S3_BUCKET_NAME, AWS_REGION

  📄 src/services/notifier.js
     Send SNS notification on upload complete
     Env vars: SNS_TOPIC_ARN, AWS_REGION

📦 DEPENDENCIES TO BE ADDED:

  📄 package.json
     @aws-sdk/client-s3, @aws-sdk/client-sns, dotenv

================================================================================

⚙️  Applying changes to your codebase...

   ✏️  Modifying src/routes/upload.js...
      ✓ Modified

   ✏️  Modifying src/services/notifier.js...
      ✓ Modified

   📦 Updating package.json...
      ✓ Updated

================================================================================

📊 Results: 3 succeeded, 0 failed

🔍 Review the changes:

diff --git a/package.json b/package.json
index 1234567..abcdefg 100644
--- a/package.json
+++ b/package.json
@@ -10,6 +10,9 @@
   "dependencies": {
     "express": "^4.18.0",
+    "@aws-sdk/client-s3": "^3.0.0",
+    "@aws-sdk/client-sns": "^3.0.0",
+    "dotenv": "^16.0.0"
   }
 }

diff --git a/src/routes/upload.js b/src/routes/upload.js
index 2345678..bcdefgh 100644
--- a/src/routes/upload.js
+++ b/src/routes/upload.js
@@ -1,5 +1,7 @@
 const express = require('express');
 const multer = require('multer');
+const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
+const s3Client = new S3Client({ region: process.env.AWS_REGION });

 async function handleUpload(req, res) {
   const file = req.file;

   // Validate file
   if (!file) {
     return res.status(400).json({ error: 'No file provided' });
   }
+
+  // Upload to S3
+  await s3Client.send(new PutObjectCommand({
+    Bucket: process.env.S3_BUCKET_NAME,
+    Key: file.originalname,
+    Body: file.buffer,
+  }));

================================================================================

❓ Keep these changes? [yes/no] (default: yes):
```

## If User Says "No"

```bash
❓ Keep these changes? [yes/no] (default: yes): no

🔄 Reverting changes...

   ✓ Reverted src/routes/upload.js
   ✓ Reverted src/services/notifier.js
   ✓ Reverted package.json

✅ Changes reverted. Proceeding to CDK generation without integration.
```

## Debugging Directory Issues

If the agent can't find your files, check:

1. **What directory is being scanned?**
   ```
   📂 Scanning directory: /Users/you/wrong/path
   ```
   If this is wrong, run: `infra-agent /correct/path`

2. **What files were found?**
   ```
   ✓ Found 0 source files
   ```
   This means either:
   - You're in the wrong directory
   - Your project has no .py/.js/.go files
   - Files are .gitignored

3. **Check the file list**
   The agent prints the first 10 files it found. If your files aren't there, they weren't detected.

## Running from Correct Directory

### Option 1: Specify path
```bash
infra-agent /path/to/your/project
```

### Option 2: cd first
```bash
cd /path/to/your/project
infra-agent
```

### Option 3: From anywhere (if using npm link)
```bash
infra-agent ~/projects/my-app
```

## Notes

- Changes are applied **before** you approve, so you can review the actual diff
- If you reject, changes are automatically reverted using `git checkout`
- If files aren't in git, they can't be auto-reverted (manual cleanup needed)
- The agent only sees files tracked by git (uses `git ls-files`)
- Works best in git repositories

## Alternative Review Methods

Instead of relying on terminal output, you can also:

### Check in Your IDE
```bash
# While the agent waits for approval:
# 1. Switch to your editor
# 2. See the changes highlighted
# 3. Review at your own pace
# 4. Return to terminal and answer yes/no
```

### Use git CLI
```bash
# In another terminal while agent waits:
git diff
git diff --stat
git status
```

### Use a GUI tool
```bash
# Open your git client (GitKraken, SourceTree, etc.)
# Review changes visually
# Return to terminal
```
