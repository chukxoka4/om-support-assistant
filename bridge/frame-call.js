#!/usr/bin/env node
// Dev harness for testing the bridge standalone — frames each JSON argument as a
// native-messaging request, pipes them into claude-bridge.js, and prints the
// decoded framed replies. Not used by the extension; kept for manual smoke tests.
//
// Examples:
//   node bridge/frame-call.js '{"ping":true}'
//   node bridge/frame-call.js '{"system":"Fix spelling only. Return only the text.","user":"teh cat","mode":"transform"}'
//   node bridge/frame-call.js '{"system":"...","user":"...","mode":"reason"}'

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodeFrame, createFrameDecoder } from "./frame-codec.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const reqs = process.argv.slice(2).map((s) => JSON.parse(s));
if (!reqs.length) {
  process.stderr.write("usage: node bridge/frame-call.js '<json-request>' [...]\n");
  process.exit(2);
}

const child = spawn("node", [join(HERE, "claude-bridge.js")], {
  stdio: ["pipe", "pipe", "inherit"],
});
const dec = createFrameDecoder();
child.stdout.on("data", (chunk) => {
  for (const reply of dec.push(chunk)) console.log("REPLY:", JSON.stringify(reply));
});
child.on("close", (code) => console.log("bridge exited", code));

for (const r of reqs) child.stdin.write(encodeFrame(r));
child.stdin.end();
