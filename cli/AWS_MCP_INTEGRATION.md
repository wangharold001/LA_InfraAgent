# AWS MCP Integration Guide

The InfraAgent CDK code generation agent is designed to reference AWS documentation while generating code. This ensures generated CDK code follows AWS best practices and uses correct APIs.

## Current Implementation

### Built-in Documentation (Active)

The agent currently uses a comprehensive built-in knowledge base that includes:

- **All major AWS services**: Lambda, DynamoDB, S3, RDS, API Gateway, VPC, etc.
- **CDK L2 construct patterns**: Correct TypeScript syntax and imports
- **Integration methods**: How to connect services (grants, event sources, etc.)
- **Best practices**: Security, cost optimization, reliability
- **Production defaults**: Encryption, retention policies, monitoring

See: `cli/src/cdk-generator.js` → `queryAWSDocumentation()` function

### How It Works

1. Agent receives architecture diagram with metadata
2. Before writing each construct, queries documentation:
   ```javascript
   // Agent calls:
   aws_kb_retrieve({ query: "CDK Lambda Function TypeScript" })

   // Returns official CDK patterns:
   new lambda.Function(this, 'MyFn', {
     runtime: lambda.Runtime.NODEJS_20_X,
     handler: 'index.handler',
     code: lambda.Code.fromAsset('lambda'),
     // ... complete with best practices
   })
   ```
3. Agent writes code using verified patterns
4. Results in production-ready, type-safe CDK code

## Future: AWS MCP Server Integration

### What is AWS MCP?

The [AWS MCP Server](https://github.com/awslabs/mcp) is an official Model Context Protocol server from AWS Labs that provides:

- Real-time access to AWS documentation
- Up-to-date CDK construct references
- CloudFormation resource specifications
- AWS best practices and patterns
- Service quotas and limits

### Integration Plan

To integrate with the official AWS MCP server:

#### 1. Installation

```bash
# Install AWS MCP server (when available)
npm install -g @aws/mcp-server-aws

# Or add to project
cd cli
npm install @aws/mcp-server-aws
```

#### 2. Configuration

Add MCP client to `cdk-generator.js`:

```javascript
import { MCPClient } from '@aws/mcp-server-aws';

// Initialize MCP client
const mcpClient = process.env.AWS_MCP_ENABLED === 'true'
  ? new MCPClient({ /* config */ })
  : null;
```

#### 3. Update Documentation Query

Modify `queryAWSDocumentation()` to use MCP:

```javascript
async function queryAWSDocumentation(query) {
  console.log(`   📚 Querying AWS docs: "${query}"`);

  // Try AWS MCP first
  if (mcpClient) {
    try {
      const result = await mcpClient.query({
        source: 'aws-cdk',
        query: query,
        language: 'typescript',
      });

      if (result && result.content) {
        return result.content;
      }
    } catch (error) {
      console.log(`   ⚠ AWS MCP query failed, using built-in docs`);
    }
  }

  // Fallback to built-in docs
  return getBuiltInDocumentation(query);
}
```

#### 4. Environment Variables

```bash
# Enable AWS MCP integration
export AWS_MCP_ENABLED=true

# Optional: Configure MCP endpoint
export AWS_MCP_ENDPOINT=http://localhost:3000
```

### Benefits of MCP Integration

1. **Always Up-to-Date**: Latest CDK APIs and deprecation warnings
2. **Broader Coverage**: Access to all AWS services, not just built-in ones
3. **Real Examples**: Official AWS example repositories
4. **Service Quotas**: Check limits before generating resources
5. **Regional Info**: Service availability by region

### Example Queries

With AWS MCP, the agent could make these queries:

```javascript
// Get latest Lambda runtime versions
await mcpClient.query({
  source: 'aws-lambda',
  query: 'supported runtime versions',
});

// Check if service available in region
await mcpClient.query({
  source: 'aws-regions',
  query: 'is ECS available in eu-north-1',
});

// Get CloudFormation resource spec
await mcpClient.query({
  source: 'aws-cloudformation',
  query: 'AWS::Lambda::Function properties',
});

// Find integration patterns
await mcpClient.query({
  source: 'aws-cdk-examples',
  query: 'Lambda DynamoDB Streams integration',
});
```

## Current vs. Future

| Feature | Built-in Docs (Current) | AWS MCP (Future) |
|---------|-------------------------|------------------|
| **Coverage** | 15+ core services | All AWS services |
| **Freshness** | Updated with releases | Real-time |
| **Examples** | Hand-curated patterns | Official AWS examples |
| **Validation** | Static patterns | Dynamic quotas/limits |
| **Setup** | Zero configuration | Requires MCP server |
| **Latency** | Instant | Network call |
| **Offline** | ✅ Works offline | ❌ Requires connection |

## Hybrid Approach (Recommended)

The ideal implementation uses both:

```javascript
async function queryAWSDocumentation(query) {
  // Try MCP for latest docs
  if (mcpClient) {
    const mcpResult = await mcpClient.query(query);
    if (mcpResult) return mcpResult;
  }

  // Fallback to fast built-in docs
  return getBuiltInDocumentation(query);
}
```

This provides:
- ✅ Speed: Built-in docs are instant
- ✅ Reliability: Works offline
- ✅ Freshness: MCP provides updates
- ✅ Coverage: MCP handles rare services

## Implementation Status

- [x] Built-in documentation for major services
- [x] Tool definition for `aws_kb_retrieve`
- [x] Agent system prompt instructs doc usage
- [x] Documentation query before code generation
- [ ] AWS MCP client integration
- [ ] Dynamic service discovery via MCP
- [ ] Real-time CDK API validation
- [ ] Regional availability checks

## Testing Documentation Quality

To verify the agent uses documentation correctly:

```bash
cd cli

# Generate infrastructure with verbose logging
DEBUG=true node bin/infra-agent.js

# Should see:
#   📚 Querying AWS docs: "CDK Lambda Function TypeScript"
#   📚 Querying AWS docs: "DynamoDB table production settings"
# etc.
```

The generated code should:
- Use TypeScript enums (`lambda.Runtime.NODEJS_20_X`)
- Not use magic strings
- Include best practice settings
- Have proper imports

## Contributing

To add more built-in documentation:

1. Edit `cli/src/cdk-generator.js`
2. Add service to `docs` object in `queryAWSDocumentation()`
3. Include:
   - Imports
   - Basic construct example
   - Common props
   - Integration patterns
   - Best practices
4. Add query matcher in function bottom
5. Test with sample architecture

## Resources

- [AWS MCP Server](https://github.com/awslabs/mcp) - Official MCP implementation
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification
- [AWS CDK Docs](https://docs.aws.amazon.com/cdk/api/v2/) - CDK API reference
- [CDK Examples](https://github.com/aws-samples/aws-cdk-examples) - Official examples

---

**Note**: AWS MCP integration is planned for a future release. The current built-in documentation provides comprehensive coverage for all supported services and follows AWS best practices.
