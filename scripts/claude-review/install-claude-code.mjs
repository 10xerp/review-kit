#!/usr/bin/env node
/**
 * Download pinned Claude Code linux-x64 binary (manifest + sha256). Stdout: executable path or empty.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function parseClaudeCodeVersionFromRunTs(source) {
  const m = source.match(/const claudeCodeVersion = "([^"]+)"/);
  return m?.[1] ?? null;
}

export async function fetchActionRunTs(actionRef) {
  const url = `https://raw.githubusercontent.com/anthropics/claude-code-action/${actionRef}/src/entrypoints/run.ts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch action run.ts (${res.status})`);
  return res.text();
}

export async function resolveClaudeCodeVersion(actionRef) {
  const runTs = await fetchActionRunTs(actionRef);
  const version = parseClaudeCodeVersionFromRunTs(runTs);
  if (!version) throw new Error("Could not parse claudeCodeVersion from action run.ts");
  return version;
}

export async function fetchManifest(version) {
  const url = `https://downloads.claude.ai/claude-code-releases/${version}/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch manifest (${res.status})`);
  return res.json();
}

export async function sha256File(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export async function downloadClaudeCodeBinary(version, outDir) {
  const manifest = await fetchManifest(version);
  const platform = manifest.platforms["linux-x64"];
  if (!platform) throw new Error("manifest.json missing linux-x64 platform");

  await mkdir(outDir, { recursive: true });
  const dest = path.join(outDir, platform.binary);
  const url = `https://downloads.claude.ai/claude-code-releases/${version}/linux-x64/${platform.binary}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download Claude Code binary (${res.status})`);

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  const checksum = await sha256File(dest);
  if (checksum !== platform.checksum) {
    throw new Error(`Checksum mismatch: expected ${platform.checksum}, got ${checksum}`);
  }

  await chmod(dest, 0o755);
  return { executablePath: dest, version: manifest.version, checksum };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const outIdx = args.indexOf("--out-dir");
  const refIdx = args.indexOf("--action-ref");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : "";
  const actionRef = refIdx >= 0 ? args[refIdx + 1] : "";

  if ((!outDir && !dryRun) || !actionRef) {
    console.error("Usage: install-claude-code.mjs --action-ref <sha> (--out-dir <dir> | --dry-run)");
    process.exit(2);
  }

  try {
    const version = await resolveClaudeCodeVersion(actionRef);
    if (dryRun) {
      const manifest = await fetchManifest(version);
      process.stdout.write(`${version}\n${manifest.platforms["linux-x64"]?.checksum ?? ""}\n`);
      return;
    }
    const { executablePath, checksum } = await downloadClaudeCodeBinary(version, outDir);
    await writeFile(
      path.join(outDir, "install-meta.json"),
      JSON.stringify({ version, checksum, actionRef, method: "direct" }),
    );
    process.stdout.write(executablePath);
  } catch (err) {
    console.error(`::warning::Claude Code direct install failed: ${err.message}`);
    process.stdout.write("");
  }
}

if (process.argv[1]?.includes("install-claude-code")) {
  void main();
}
