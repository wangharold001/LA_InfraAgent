import fs from "fs";
import path from "path";

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

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".terraform", "vendor", "coverage", ".nyc_output", "cdk.out",
]);

const SKIP_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2",
  ".ttf", ".eot", ".mp4", ".mp3", ".pdf", ".zip", ".tar", ".gz",
  ".lock", ".sum",
]);

const MAX_FILE_BYTES = 8_000;
const MAX_TOTAL_BYTES = 60_000;

function walk(dir, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return files; }

  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, files);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!SKIP_EXTS.has(ext)) files.push(full);
    }
  }
  return files;
}

function score(file, root) {
  const rel = path.relative(root, file);
  const base = path.basename(file);

  if (PRIORITY_FILES.includes(base)) return 100;
  if (PRIORITY_GLOBS.some(r => r.test(rel))) return 80;

  // entry points
  if (/^(index|main|app|server|handler)\.(js|ts|py|go|rb)$/.test(base)) return 60;

  // infra-adjacent config
  if (/\.(ya?ml|toml|json)$/.test(base) && !rel.includes("node_modules")) return 40;

  return 10;
}

export function readRepo(root) {
  const all = walk(root);
  all.sort((a, b) => score(b, root) - score(a, root));

  const chunks = [];
  let total = 0;

  for (const file of all) {
    if (total >= MAX_TOTAL_BYTES) break;
    let content;
    try { content = fs.readFileSync(file, "utf8"); }
    catch { continue; }

    if (content.trim().length === 0) continue;

    const truncated = content.length > MAX_FILE_BYTES
      ? content.slice(0, MAX_FILE_BYTES) + "\n... (truncated)"
      : content;

    const rel = path.relative(root, file);
    const chunk = `### ${rel}\n\`\`\`\n${truncated}\n\`\`\``;
    chunks.push(chunk);
    total += chunk.length;
  }

  return chunks.join("\n\n");
}
