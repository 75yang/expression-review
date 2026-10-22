import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
const entries = new Map();
for (const line of git("ls-files", "--stage").split("\n").filter(Boolean)) {
  const [metadata, file] = line.split("\t");
  const [mode, oid] = metadata.split(" ");
  if (mode === "120000" || mode === "160000") throw new Error(`Links/submodules are not allowed: ${file}`);
  entries.set(`${oid}:${file}`, { oid, file });
}
for (const line of git("rev-list", "--objects", "--all").split("\n").filter(Boolean)) {
  const separator = line.indexOf(" ");
  if (separator < 0) continue;
  const oid = line.slice(0, separator), file = line.slice(separator + 1);
  if (git("cat-file", "-t", oid) === "blob") entries.set(`${oid}:${file}`, { oid, file });
}
if (!entries.size) throw new Error("No staged or committed source files. Stage the public source first.");
const failures = [];
const forbiddenPath = /(^|\/)(node_modules|\.next|\.vercel|\.workbuddy|local-material-library|transcripts|waveforms|thumbnails|videos)(\/|$)|^recordings\/|\.expression-training-|\.(sqlite[^/]*|db[^/]*|mp4|mov|m4a|mp3|wav|webm|ogg|flac|png|jpe?g|webp|log|zip|tsbuildinfo)$/i;
const extensions = /\.(ts|tsx|mjs|css|svg|json|md|py|txt|ya?ml)$/i;
const rootFiles = new Set([".gitignore", ".env.example", "LICENSE"]);
for (const { oid, file } of entries.values()) {
  if (forbiddenPath.test(file) || /(^|\/)\.env/.test(file) && file !== ".env.example" || !extensions.test(file) && !rootFiles.has(file)) {
    failures.push(`${file}: forbidden file type or runtime data path`); continue;
  }
  const size = Number(git("cat-file", "-s", oid));
  if (size > 1_000_000) { failures.push(`${file}: unexpected large source file`); continue; }
  const content = git("cat-file", "blob", oid);
  const patterns = [
    /(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /[A-Za-z]:[\\/](?:Users[\\/]|0604[\\/])/,
    /(?:apiKey|api_key|token_hash|secret)\s*[=:]\s*["'][A-Za-z0-9_-]{24,}["']/i,
  ];
  if (patterns.some((pattern) => pattern.test(content))) failures.push(`${file}: possible credential or personal machine path`);
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`PASS: ${entries.size} staged/history blobs inspected; no forbidden runtime data or recognized secrets.`);
