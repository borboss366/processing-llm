// Shared runner for the owner CLI (brief 19.2 follow-up): every wrapper
// prints the EXACT underlying command before running it (the shortcut must
// hide nothing), streams output live, and returns the captured lines so
// the wrapper can grep its summary.
import { spawn } from "node:child_process";

export function runShown(cmd, args) {
  console.log(`\n$ ${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["inherit", "pipe", "inherit"] });
    let buf = "";
    p.stdout.on("data", (d) => { process.stdout.write(d); buf += d; });
    p.on("close", (code) => {
      if (code === 0) return resolve(buf.split("\n"));
      // owner CLI: fail CLEAN — the wrapped tool already printed its
      // diagnosis; a JS stack trace on top only buries it
      console.error(`\n✗ step failed (exit ${code}): ${cmd} ${args.filter((a) => !a.startsWith("/")).join(" ")}`);
      console.error("  the tool's last lines above say why; fix and rerun the same command");
      process.exit(code);
    });
  });
}

export const grep = (lines, re) => lines.filter((l) => re.test(l));
