#!/usr/bin/env node
// Pre-commit guard: if staged code touches lib/providers/mcp-intercom/entry-points,
// the same commit must touch tests/. Fails otherwise.

import { execSync } from "node:child_process";

const staged = execSync("git diff --cached --name-only --diff-filter=ACMR", {
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const codeRe = /^(lib|providers|mcp-intercom)\/.+\.js$|^(sidepanel|options|background|content|content-overlay|content-ticket)\.js$/;
const testRe = /^tests\//;

const codeTouched = staged.filter((f) => codeRe.test(f));
const testsTouched = staged.some((f) => testRe.test(f));

if (codeTouched.length > 0 && !testsTouched) {
  console.error("");
  console.error("✗ Commit blocked: code changed without test changes.");
  console.error("  Files needing test coverage in this commit:");
  for (const f of codeTouched) console.error("    " + f);
  console.error("");
  console.error("  Add or update a file under tests/ in this commit, or run");
  console.error("  with --no-verify only if you have a deliberate reason.");
  console.error("");
  process.exit(1);
}
