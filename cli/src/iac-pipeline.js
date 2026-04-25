import readline from "readline/promises";
import { getApproval } from "./approval.js";
import { generateCDKCode } from "./cdk-generator.js";
import { deployCDK, generateReadme } from "./deployer.js";

export async function runIaCPipeline(finalState, cdkOutputDir, apiKey) {
  // Phase 2: Approval
  console.log("\n📍 PHASE 2: Review & Approval\n");

  const approved = await getApproval(finalState);

  if (!approved) {
    console.log("\n⏸️  Process stopped. You can:");
    console.log(`   - Re-open the diagram: diagram`);
    console.log(`   - Re-run with a different prompt\n`);
    return false;
  }

  // Phase 3: CDK Code Generation
  console.log("\n📍 PHASE 3: CDK Code Generation\n");

  let generatedFiles;
  try {
    generatedFiles = await generateCDKCode(finalState, cdkOutputDir, apiKey);
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

  // Phase 4: Deployment
  console.log("\n📍 PHASE 4: Deployment\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const shouldDeploy = await rl.question("Deploy to AWS now? (yes/no): ");
  rl.close();

  if (shouldDeploy.trim().toLowerCase() === "yes" || shouldDeploy.trim().toLowerCase() === "y") {
    const deployed = await deployCDK(cdkOutputDir, finalState.metadata);

    if (deployed) {
      console.log("\n" + "=".repeat(80));
      console.log("🎉 SUCCESS! Your infrastructure is now live on AWS!");
      console.log("=".repeat(80));
      console.log(`\nCDK Project: ${cdkOutputDir}`);
      console.log("\nTo manage your infrastructure:");
      console.log(`  cd ${cdkOutputDir}`);
      console.log(`  cdk diff     # See changes`);
      console.log(`  cdk deploy   # Deploy updates`);
      console.log(`  cdk destroy  # Tear down stack\n`);
    } else {
      console.log("\n⚠️  Deployment was not completed.");
      console.log(`\nYou can deploy manually later:`);
      console.log(`  cd ${cdkOutputDir}`);
      console.log(`  npm install && npm run build && cdk deploy\n`);
    }
  } else {
    console.log("\n⏸️  Skipping deployment.");
    console.log(`\nTo deploy later:`);
    console.log(`  cd ${cdkOutputDir}`);
    console.log(`  npm install && npm run build`);
    console.log(`  cdk deploy\n`);
  }

  return true;
}
