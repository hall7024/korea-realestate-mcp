#!/usr/bin/env node
import { runStdio } from "../mcp/server.js";
import { runCli } from "./commands.js";

const code = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdinIsTTY: Boolean(process.stdin.isTTY),
  startServer: runStdio,
});
// 서버를 띄웠으면(null) 프로세스를 그대로 둔다
if (code !== null) process.exitCode = code;
