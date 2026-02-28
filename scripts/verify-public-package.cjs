#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function main() {
  const cacheDir = path.resolve(process.cwd(), ".npm-cache-packcheck");
  const output = execSync(`npm pack --dry-run --json --cache "${cacheDir}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(output);
  const files = Array.isArray(parsed) && parsed[0]?.files ? parsed[0].files : [];
  const paths = files.map((entry) => entry.path);

  const forbiddenPrefixes = [
    "src/",
    "host.json",
    "local.settings.example.json",
    "tsp-output/",
  ];

  const forbidden = paths.filter((path) =>
    forbiddenPrefixes.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}`)
    )
  );

  if (forbidden.length > 0) {
    console.error("Public package check failed. Forbidden publish paths found:");
    for (const path of forbidden) {
      console.error(`- ${path}`);
    }
    process.exit(1);
  }

  const requiredPaths = ["dist/index.js", "dist/index.d.ts"];
  const missing = requiredPaths.filter((requiredPath) => !paths.includes(requiredPath));

  if (missing.length > 0) {
    console.error("Public package check failed. Missing required package files:");
    for (const path of missing) {
      console.error(`- ${path}`);
    }
    process.exit(1);
  }

  const forbiddenCodeReferencePatterns = [
    { label: "brand namespace reference", regex: /\bplasius\b/i },
    { label: "private monorepo reference", regex: /\bplasius-ltd-site\b/i },
    { label: "proprietary PGP artifact reference", regex: /\bpgp[-_a-z0-9]*\b/i },
    { label: "proprietary Lunari artifact reference", regex: /\blunari\b/i },
    { label: "proprietary Pixelverse artifact reference", regex: /\bpixelverse\b/i },
  ];

  const codeRoots = ["src", "tests", "demo"];
  const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);
  const violations = scanCodeReferences(
    codeRoots,
    codeExtensions,
    forbiddenCodeReferencePatterns
  );

  if (violations.length > 0) {
    console.error(
      "Public package check failed. Forbidden private/product code references found:"
    );
    for (const violation of violations) {
      console.error(
        `- ${violation.file}:${violation.line} (${violation.label})`
      );
    }
    process.exit(1);
  }

  console.log("Public package check passed.");
}

function scanCodeReferences(roots, extensions, patterns) {
  const allFiles = [];
  for (const root of roots) {
    allFiles.push(...collectFiles(path.resolve(process.cwd(), root), extensions));
  }

  const violations = [];
  for (const file of allFiles) {
    const contents = fs.readFileSync(file, "utf8");

    for (const pattern of patterns) {
      const matchIndex = contents.search(pattern.regex);
      if (matchIndex < 0) {
        continue;
      }

      const beforeMatch = contents.slice(0, matchIndex);
      const line = beforeMatch.split(/\r?\n/u).length;
      violations.push({
        file: path.relative(process.cwd(), file),
        line,
        label: pattern.label,
      });
      break;
    }
  }

  return violations;
}

function collectFiles(root, extensions) {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, extensions));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

main();
