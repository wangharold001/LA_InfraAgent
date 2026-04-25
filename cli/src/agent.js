import Anthropic from "@anthropic-ai/sdk";
import { createDiagram, TOOLS } from "./diagram.js";

const SYSTEM = (repoContext) => {
  let prompt = `\
You are an expert AWS solutions architect. Your output is consumed by a downstream CDK code-generation agent — every node and edge must be filled in completely so that agent needs zero guesswork.
Use the provided tools to build the diagram. Do not explain — just call the tools.

METADATA — call set_metadata first with name, stackName, region, and environment (dev/staging/prod).

NODES — always call add_node with:
- cdkId: PascalCase unique construct ID (e.g. "UserAuthFunction", "OrdersTable")
- props: full CDK props object — include ALL fields for the service type, not just ones the user mentioned. Fill unspecified fields with AWS recommended defaults.
  Key rules by type:
  lambda: runtime, handler, code path, memorySize, timeout, environment map, tracing "Active", removalPolicy
  dynamodb: partitionKey {name,type}, billingMode, pointInTimeRecovery true, encryption, removalPolicy "RETAIN" for prod
  s3: versioned, blockPublicAccess "BLOCK_ALL", encryption, removalPolicy, autoDeleteObjects
  sqs: fifo, visibilityTimeout (match Lambda timeout if event source), messageRetentionPeriod, maxReceiveCount, encryption
  rds: engine, engineVersion, instanceClass, instanceSize, databaseName, multiAz, storageEncrypted true, removalPolicy "SNAPSHOT"
  All stateful resources (rds, dynamodb, s3, elasticache): default removalPolicy to "RETAIN" unless environment is dev
- notes: 1–2 sentences on the resource's role and any non-obvious decisions

EDGES — always call add_edge with:
- relationship: one of [iam-grant, event-source-mapping, subscription, api-integration, origin, trigger, invoke, stream-consumer, read, write, read-write]
- iamActions: explicit IAM action strings (e.g. ["dynamodb:GetItem","dynamodb:PutItem"]). Use [] only for non-IAM relationships.
- cdkMethod: the exact CDK L2 call (e.g. "table.grantReadWriteData(fn)", "fn.addEventSource(new SqsEventSource(queue,{batchSize:10}))")
- protocol: how they communicate (AWS SDK v3 / HTTPS / SQS trigger / etc.)

LAYOUT — left-to-right data flow (x ≥ 320px between same-row nodes), top-to-bottom tiers (y ~160px apart).
Valid node types: lambda, ec2, fargate, rds, dynamodb, s3, elasticache, sqs, sns, apigateway, alb, vpc, cloudfront, external, user. Use "external" for anything else.`;

  if (repoContext) {
    prompt += `\n\nRepository files:\n${repoContext}`;
  }
  return prompt;
};

export async function runAgent(repoContext, userPrompt, apiKey, { onTool } = {}) {
  if (process.env.MOCK_API === "true") {
    const { state, executeTool } = createDiagram();
    executeTool("set_metadata", { name: "Mock Architecture", stackName: "MockStack", region: "us-east-1", environment: "dev" });
    const api = executeTool("add_node", { type: "apigateway", label: "API Gateway", cdkId: "ApiGateway", x: 80,  y: 200 });
    const fn  = executeTool("add_node", { type: "lambda",     label: "Handler",     cdkId: "HandlerFn",  x: 480, y: 200 });
    const db  = executeTool("add_node", { type: "dynamodb",   label: "Table",       cdkId: "AppTable",   x: 880, y: 200 });
    executeTool("add_edge", { from_id: api.id, to_id: fn.id, label: "invoke", relationship: "api-integration", cdkMethod: "api.addRoutes({integration: new HttpLambdaIntegration('Handler', fn)})", protocol: "HTTPS", iamActions: [] });
    executeTool("add_edge", { from_id: fn.id,  to_id: db.id, label: "read/write", relationship: "iam-grant", cdkMethod: "table.grantReadWriteData(fn)", protocol: "AWS SDK v3", iamActions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"] });
    return state;
  }

  const client = new Anthropic({ apiKey });
  const { state, executeTool } = createDiagram();

  const messages = [{ role: "user", content: userPrompt }];

  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM(repoContext),
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (onTool) onTool(block.name, block.input);
      const result = executeTool(block.name, block.input);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }

    messages.push({ role: "user", content: results });
  }

  return state;
}
