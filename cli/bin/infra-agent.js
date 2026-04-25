#!/usr/bin/env node
import path from "path";
import fs from "fs";
import readline from "readline/promises";
import { readRepo } from "../src/reader.js";
import { runAgent, MODE_PROMPTS } from "../src/agent.js";
import { writeAndOpen } from "../src/renderer.js";

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const outputPath = path.join(repoRoot, "infra-diagram.html");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  process.exit(1);
}

const MODES = Object.keys(MODE_PROMPTS);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const userPrompt = (await rl.question('What would you like to diagram? (diagram my current directory): ')).trim()
  || "diagram my current directory";

console.log(`\nGeneration modes: ${MODES.map((m, i) => `[${i + 1}] ${m}`).join("  ")}`);
const modeAnswer = (await rl.question("Choose mode (default: simple): ")).trim();
const modeIndex = parseInt(modeAnswer, 10) - 1;
const mode = (modeIndex >= 0 && modeIndex < MODES.length) ? MODES[modeIndex]
  : MODES.includes(modeAnswer) ? modeAnswer
  : "simple";
rl.close();

let repoContext = "";
if (fs.existsSync(repoRoot)) {
  process.stdout.write("Reading repo... ");
  repoContext = readRepo(repoRoot);
  console.log(repoContext ? "done." : "no source files found, proceeding without repo context.");
}

console.log(`\nGenerating diagram with Claude (mode: ${mode})...\n`);

const state = await runAgent(repoContext, userPrompt, apiKey, {
  mode,
  onTool: (name, input) => {
    if (name === "add_node") console.log(`  + node  ${input.type.padEnd(12)} ${input.label || ""}`);
    if (name === "add_edge") console.log(`  + edge  ${input.from_id} → ${input.to_id}${input.label ? ` (${input.label})` : ""}`);
    if (name === "set_metadata") console.log(`  * name  ${input.name}`);
  },
});

console.log(`\nDiagram: ${state.nodes.length} nodes, ${state.edges.length} edges`);

const out = writeAndOpen(state, outputPath);
console.log(`\nOpened: ${out}`);
console.log("You can continue editing the diagram manually in the browser.");
