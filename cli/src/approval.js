import readline from "readline/promises";

/**
 * Display the generated architecture and get user approval
 * @param {object} state - The diagram state
 * @returns {Promise<boolean>} - true if approved, false otherwise
 */
export async function getApproval(state) {
  console.log("\n" + "=".repeat(80));
  console.log("📋 GENERATED ARCHITECTURE");
  console.log("=".repeat(80));

  console.log("\n📦 Stack Configuration:");
  console.log(`   Name:        ${state.metadata.name}`);
  console.log(`   Stack Name:  ${state.metadata.stackName}`);
  console.log(`   Region:      ${state.metadata.region}`);
  console.log(`   Environment: ${state.metadata.environment}`);

  console.log(`\n🏗️  Resources (${state.nodes.length} nodes):`);

  // Group nodes by provider
  const byProvider = {};
  for (const node of state.nodes) {
    const p = node.provider || "aws";
    if (!byProvider[p]) byProvider[p] = [];
    byProvider[p].push(node);
  }

  const providerLabels = { aws: "AWS", azure: "Azure", gcp: "GCP", generic: "Generic" };
  for (const [provider, nodes] of Object.entries(byProvider)) {
    console.log(`\n   ${providerLabels[provider] || provider.toUpperCase()}:`);
    for (const node of nodes) {
      console.log(`     • ${node.label} (${node.tfId || node.type})`);
      if (node.tfResource) console.log(`       Terraform: ${node.tfResource}`);
      if (node.notes) console.log(`       ${node.notes}`);
      const keyProps = getKeyProps(node);
      if (keyProps.length > 0) console.log(`       Props: ${keyProps.join(", ")}`);
    }
  }

  console.log(`\n🔗 Connections (${state.edges.length} edges):`);
  for (const edge of state.edges) {
    const from = state.nodes.find(n => n.id === edge.from);
    const to = state.nodes.find(n => n.id === edge.to);
    console.log(`   ${from?.label || edge.from} → ${to?.label || edge.to}`);
    console.log(`     Relationship: ${edge.relationship}`);
    if (edge.permissions && edge.permissions.length > 0) {
      console.log(`     Permissions: ${edge.permissions.join(", ")}`);
    }
    if (edge.tfRef) {
      console.log(`     Terraform: ${edge.tfRef}`);
    }
  }

  console.log("\n" + "=".repeat(80));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await rl.question(
    "\n✅ Proceed with CDK code generation? (yes/no): "
  );
  rl.close();

  return answer.trim().toLowerCase() === "yes" || answer.trim().toLowerCase() === "y";
}

/**
 * Extract key properties to display for a node
 */
function getKeyProps(node) {
  const props = node.props || {};
  const key = [];

  switch (node.type) {
    case "lambda":
      if (props.runtime) key.push(`runtime: ${props.runtime}`);
      if (props.memorySize) key.push(`memory: ${props.memorySize}MB`);
      if (props.timeout) key.push(`timeout: ${props.timeout}s`);
      break;
    case "dynamodb":
      if (props.billingMode) key.push(`billing: ${props.billingMode}`);
      if (props.partitionKey) key.push(`pk: ${props.partitionKey.name}`);
      break;
    case "rds":
      if (props.engine) key.push(`engine: ${props.engine}`);
      if (props.instanceClass && props.instanceSize) {
        key.push(`instance: ${props.instanceClass}.${props.instanceSize}`);
      }
      break;
    case "s3":
      if (props.versioned) key.push("versioned");
      if (props.encryption) key.push(`encryption: ${props.encryption}`);
      break;
    case "vpc":
      if (props.cidr) key.push(`cidr: ${props.cidr}`);
      if (props.maxAzs) key.push(`azs: ${props.maxAzs}`);
      break;
    default:
      // Show first 3 non-null props
      const entries = Object.entries(props).filter(([k, v]) => v != null);
      key.push(...entries.slice(0, 3).map(([k, v]) => `${k}: ${JSON.stringify(v)}`));
  }

  return key;
}
