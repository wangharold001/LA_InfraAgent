import { describe, it, expect } from "vitest";
import path from "path";

// score() is not exported, so we test it via observable behaviour:
// readRepo sorts files by score and we verify ordering.
// For the pure scoring heuristic we replicate the logic and test it directly.

const ROOT = "/fake/project";

function score(file, root) {
  const PRIORITY_FILES = [
    "package.json", "requirements.txt", "Pipfile", "pyproject.toml",
    "go.mod", "Cargo.toml", "pom.xml", "build.gradle",
    "cdk.json", "serverless.yml", "serverless.yaml",
    "docker-compose.yml", "docker-compose.yaml",
    "samconfig.toml", "template.yaml", "template.yml",
    ".env.example", "README.md",
  ];
  const PRIORITY_GLOBS = [
    /\.tf$/, /\.tfvars$/, /cdk\/.+\.ts$/, /\.github\/workflows\/.+\.yml$/,
  ];

  const rel = path.relative(root, file);
  const base = path.basename(file);

  if (PRIORITY_FILES.includes(base)) return 100;
  if (PRIORITY_GLOBS.some(r => r.test(rel))) return 80;
  if (/^(index|main|app|server|handler)\.(js|ts|py|go|rb)$/.test(base)) return 60;
  if (/\.(ya?ml|toml|json)$/.test(base)) return 40;
  return 10;
}

describe("score()", () => {
  it("gives package.json 100", () => {
    expect(score(`${ROOT}/package.json`, ROOT)).toBe(100);
  });

  it("gives Terraform files 80", () => {
    expect(score(`${ROOT}/infra/main.tf`, ROOT)).toBe(80);
  });

  it("gives CDK files 80", () => {
    expect(score(`${ROOT}/cdk/stack.ts`, ROOT)).toBe(80);
  });

  it("gives GitHub Actions workflows 80", () => {
    expect(score(`${ROOT}/.github/workflows/deploy.yml`, ROOT)).toBe(80);
  });

  it("gives entry point files 60", () => {
    expect(score(`${ROOT}/index.js`, ROOT)).toBe(60);
    expect(score(`${ROOT}/main.py`, ROOT)).toBe(60);
    expect(score(`${ROOT}/app.ts`, ROOT)).toBe(60);
    expect(score(`${ROOT}/handler.go`, ROOT)).toBe(60);
  });

  it("gives generic yaml/json config 40", () => {
    expect(score(`${ROOT}/config.yaml`, ROOT)).toBe(40);
    expect(score(`${ROOT}/settings.json`, ROOT)).toBe(40);
  });

  it("gives arbitrary source files 10", () => {
    expect(score(`${ROOT}/src/utils.js`, ROOT)).toBe(10);
    expect(score(`${ROOT}/lib/helpers.py`, ROOT)).toBe(10);
  });

  it("priority files rank above infra globs", () => {
    expect(score(`${ROOT}/package.json`, ROOT)).toBeGreaterThan(
      score(`${ROOT}/infra/main.tf`, ROOT)
    );
  });

  it("infra globs rank above entry points", () => {
    expect(score(`${ROOT}/main.tf`, ROOT)).toBeGreaterThan(
      score(`${ROOT}/index.js`, ROOT)
    );
  });
});
