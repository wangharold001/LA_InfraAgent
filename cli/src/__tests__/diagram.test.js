import { describe, it, expect, beforeEach } from "vitest";
import { createDiagram } from "../diagram.js";

let d;
beforeEach(() => { d = createDiagram(); });

describe("add_node", () => {
  it("adds a node with explicit position", () => {
    const r = d.executeTool("add_node", { type: "lambda", label: "MyFn", x: 100, y: 200 });
    expect(d.state.nodes).toHaveLength(1);
    expect(d.state.nodes[0]).toMatchObject({ type: "lambda", label: "MyFn", x: 100, y: 200 });
    expect(r.id).toBeTruthy();
  });

  it("auto-places node when x/y omitted", () => {
    d.executeTool("add_node", { type: "s3" });
    expect(d.state.nodes[0].x).toBeGreaterThanOrEqual(0);
    expect(d.state.nodes[0].y).toBeGreaterThanOrEqual(0);
  });

  it("falls back to 'external' for unknown types", () => {
    d.executeTool("add_node", { type: "stepfunctions", label: "Workflow" });
    expect(d.state.nodes[0].type).toBe("external");
  });

  it("uses type label when no label given", () => {
    d.executeTool("add_node", { type: "dynamodb" });
    expect(d.state.nodes[0].label).toBe("DynamoDB");
  });
});

describe("add_edge", () => {
  it("connects two existing nodes", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0,   y: 0 });
    const b = d.executeTool("add_node", { type: "s3",     x: 200, y: 0 });
    const r = d.executeTool("add_edge", { from_id: a.id, to_id: b.id, label: "writes" });
    expect(d.state.edges).toHaveLength(1);
    expect(d.state.edges[0]).toMatchObject({ from: a.id, to: b.id, label: "writes" });
    expect(r.id).toBeTruthy();
  });

  it("returns error when source node is missing", () => {
    const b = d.executeTool("add_node", { type: "s3", x: 0, y: 0 });
    const r = d.executeTool("add_edge", { from_id: "ghost", to_id: b.id });
    expect(r.error).toMatch(/ghost/);
    expect(d.state.edges).toHaveLength(0);
  });

  it("returns error when destination node is missing", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0, y: 0 });
    const r = d.executeTool("add_edge", { from_id: a.id, to_id: "ghost" });
    expect(r.error).toMatch(/ghost/);
  });

  it("rejects self-loops", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0, y: 0 });
    const r = d.executeTool("add_edge", { from_id: a.id, to_id: a.id });
    expect(r.error).toBeTruthy();
    expect(d.state.edges).toHaveLength(0);
  });
});

describe("clear_diagram", () => {
  it("removes all nodes and edges", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0,   y: 0 });
    const b = d.executeTool("add_node", { type: "s3",     x: 200, y: 0 });
    d.executeTool("add_edge", { from_id: a.id, to_id: b.id });
    d.executeTool("clear_diagram", {});
    expect(d.state.nodes).toHaveLength(0);
    expect(d.state.edges).toHaveLength(0);
  });
});

describe("set_metadata", () => {
  it("updates the diagram name", () => {
    d.executeTool("set_metadata", { name: "My App" });
    expect(d.state.metadata.name).toBe("My App");
  });
});

describe("remove_object", () => {
  it("removes a node and its connected edges", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0,   y: 0 });
    const b = d.executeTool("add_node", { type: "s3",     x: 200, y: 0 });
    d.executeTool("add_edge", { from_id: a.id, to_id: b.id });
    d.executeTool("remove_object", { id: a.id });
    expect(d.state.nodes).toHaveLength(1);
    expect(d.state.edges).toHaveLength(0);
  });

  it("removes a single edge without touching nodes", () => {
    const a = d.executeTool("add_node", { type: "lambda", x: 0,   y: 0 });
    const b = d.executeTool("add_node", { type: "s3",     x: 200, y: 0 });
    const e = d.executeTool("add_edge", { from_id: a.id, to_id: b.id });
    d.executeTool("remove_object", { id: e.id });
    expect(d.state.nodes).toHaveLength(2);
    expect(d.state.edges).toHaveLength(0);
  });

  it("returns error for unknown id", () => {
    const r = d.executeTool("remove_object", { id: "ghost" });
    expect(r.error).toMatch(/ghost/);
  });
});
