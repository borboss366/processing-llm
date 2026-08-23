/**
 * Shared CLI arg parsing for the tools/ harnesses.
 *
 * The old per-harness pattern (`flags[k] = argv[++i]`) made every flag eat
 * the next token, so boolean flags like --verify swallowed the flag after
 * them. Rule here: a flag takes the next token as its value only when that
 * token exists and does not itself start with `--`; otherwise it is `true`.
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[a.slice(2)] = argv[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}
