import {
  SERVICE_META,
  TF_META,
  NODE_TF_DEFAULTS,
  EDGE_RELATIONSHIPS,
  VALID_NODE_TYPES_PROMPT,
} from "./diagram-services.js";

export { EDGE_RELATIONSHIPS };

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

function toSnakeCase(str) {
  return (str || "")
    .replace(/[^a-zA-Z0-9 _]/g, " ")
    .trim()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(w => w.toLowerCase())
    .join("_");
}

const MIN_DIST = 300;

export function createDiagram() {
  const state = {
    schemaVersion: "0.3.0",
    metadata: {
      name: "Untitled",
      stackName: "",
      providers: [],
      region: "us-east-1",
      account: "",
      environment: "dev",
      createdAt: new Date().toISOString(),
    },
    nodes: [],
    edges: [],
  };

  function autoPlace() {
    const candidates = [];
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 6; col++)
        candidates.push({ x: 80 + col * 200, y: 80 + row * 180 });

    for (const pt of candidates) {
      const tooClose = state.nodes.some(n => {
        const dx = n.x - pt.x, dy = n.y - pt.y;
        return Math.sqrt(dx * dx + dy * dy) < MIN_DIST;
      });
      if (!tooClose) return pt;
    }
    const maxY = state.nodes.reduce((m, n) => Math.max(m, n.y), 0);
    return { x: 80, y: maxY + 220 };
  }

  function executeTool(name, input) {
    switch (name) {
      case "add_node": {
        const pos      = (input.x != null && input.y != null) ? input : autoPlace();
        const type     = input.type in SERVICE_META ? input.type : "external";
        const meta     = SERVICE_META[type];
        const tfMeta   = TF_META[type] || { resource: null, provider: null };
        const label    = input.label || meta.label;
        const n = {
          id:         uid("n"),
          type,
          provider:   meta.provider,
          label,
          tfResource: tfMeta.resource,
          tfId:       input.tfId || toSnakeCase(label),
          notes:      input.notes || "",
          x: Math.round(pos.x / 10) * 10,
          y: Math.round(pos.y / 10) * 10,
          props: { ...(NODE_TF_DEFAULTS[type] || {}), ...(input.props || {}) },
        };
        state.nodes.push(n);
        // Track which cloud providers are used
        if (meta.provider && meta.provider !== "generic" && !state.metadata.providers.includes(meta.provider)) {
          state.metadata.providers.push(meta.provider);
        }
        return { id: n.id, label: n.label };
      }
      case "add_edge": {
        const src = state.nodes.find(n => n.id === input.from_id);
        const dst = state.nodes.find(n => n.id === input.to_id);
        if (!src) return { error: `Node ${input.from_id} not found` };
        if (!dst) return { error: `Node ${input.to_id} not found` };
        if (src.id === dst.id) return { error: "Cannot connect a node to itself" };
        const e = {
          id:           uid("e"),
          from:         src.id,
          to:           dst.id,
          label:        input.label        || "",
          relationship: input.relationship || "invoke",
          permissions:  input.permissions  || [],
          tfRef:        input.tfRef        || "",
          protocol:     input.protocol     || "",
          notes:        input.notes        || "",
        };
        state.edges.push(e);
        return { id: e.id };
      }
      case "clear_diagram":
        state.nodes = []; state.edges = [];
        Object.assign(state.metadata, {
          name: "Untitled", stackName: "", providers: [],
          region: "us-east-1", account: "", environment: "dev",
          createdAt: new Date().toISOString(),
        });
        return { ok: true };
      case "set_metadata":
        if (input.name)        state.metadata.name        = input.name;
        if (input.stackName)   state.metadata.stackName   = input.stackName;
        if (input.region)      state.metadata.region      = input.region;
        if (input.account)     state.metadata.account     = input.account;
        if (input.environment) state.metadata.environment = input.environment;
        if (Array.isArray(input.providers)) state.metadata.providers = input.providers;
        return { ok: true };
      case "remove_object": {
        const ni = state.nodes.findIndex(n => n.id === input.id);
        if (ni !== -1) {
          state.nodes.splice(ni, 1);
          state.edges = state.edges.filter(e => e.from !== input.id && e.to !== input.id);
          return { ok: true, removed: "node" };
        }
        const ei = state.edges.findIndex(e => e.id === input.id);
        if (ei !== -1) { state.edges.splice(ei, 1); return { ok: true, removed: "edge" }; }
        return { error: `No node or edge with id ${input.id}` };
      }
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  return { state, executeTool };
}

export const TOOLS = [
  {
    name: "add_node",
    description: "Add a cloud service node (AWS, Azure, or GCP). Populate tfId, props, and notes fully — the props object must contain ALL relevant Terraform attributes for that resource so the downstream Terraform generator needs zero guesswork.",
    input_schema: {
      type: "object",
      properties: {
        type:  { type: "string", description: `One of: ${VALID_NODE_TYPES_PROMPT}` },
        label: { type: "string", description: "Human-readable display name, e.g. 'User Auth Function'" },
        tfId:  { type: "string", description: "snake_case Terraform resource local name, e.g. 'user_auth_function'. Must be unique per resource type." },
        props: {
          type: "object",
          description: "Complete Terraform deployment props. Always include ALL relevant attributes for the resource type — use provider-recommended defaults for anything not specified.",
        },
        notes: { type: "string", description: "1–2 sentences describing this resource's role and any non-obvious configuration decisions." },
        x:     { type: "number", description: "Canvas x position (auto-placed if omitted)" },
        y:     { type: "number", description: "Canvas y position (auto-placed if omitted)" },
      },
      required: ["type", "label", "tfId"],
    },
  },
  {
    name: "add_edge",
    description: "Connect two nodes. Always specify relationship, permissions, tfRef, and protocol so the Terraform generator can emit correct IAM/RBAC grants and resource references without guessing.",
    input_schema: {
      type: "object",
      properties: {
        from_id:      { type: "string", description: "Source node id" },
        to_id:        { type: "string", description: "Destination node id" },
        label:        { type: "string", description: "Short display label shown on the diagram arrow" },
        relationship: {
          type: "string",
          enum: EDGE_RELATIONSHIPS,
          description: "The relationship type this edge represents.",
        },
        permissions: {
          type: "array", items: { type: "string" },
          description: "Permission strings needed: IAM action strings for AWS (e.g. 'dynamodb:GetItem'), RBAC role names for Azure (e.g. 'Storage Blob Data Reader'), IAM roles for GCP (e.g. 'roles/storage.objectViewer'). Empty array for non-permission relationships.",
        },
        tfRef:    { type: "string", description: "The Terraform resource reference or HCL expression that wires these two resources, e.g. 'aws_lambda_permission.apigw' or 'azurerm_role_assignment.func_cosmos'" },
        protocol: { type: "string", description: "Communication mechanism, e.g. 'HTTPS', 'gRPC', 'AMQP', 'Pub/Sub push'" },
        notes:    { type: "string", description: "Any non-obvious wiring details or cross-cloud connectivity constraints." },
      },
      required: ["from_id", "to_id", "relationship"],
    },
  },
  {
    name: "clear_diagram",
    description: "Remove all nodes and edges. Call before building a fresh architecture.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_metadata",
    description: "Set diagram-level metadata used by the Terraform generator to configure providers and name resources.",
    input_schema: {
      type: "object",
      properties: {
        name:        { type: "string", description: "Human-readable architecture name" },
        stackName:   { type: "string", description: "Base name used for resource naming, e.g. 'my-app'" },
        providers:   { type: "array", items: { type: "string", enum: ["aws", "azure", "gcp"] }, description: "Cloud providers used in this diagram" },
        region:      { type: "string", description: "Primary AWS region (if AWS nodes exist), e.g. 'us-east-1'" },
        account:     { type: "string", description: "AWS account ID (12 digits). Use empty string if unknown." },
        environment: { type: "string", description: "'dev', 'staging', or 'prod'" },
      },
      required: ["name"],
    },
  },
  {
    name: "remove_object",
    description: "Remove a node (and its connected edges) or a single edge by id.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The id of the node or edge to remove" } },
      required: ["id"],
    },
  },
];
