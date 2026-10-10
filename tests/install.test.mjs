import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  downloadClaudeCodeBinary,
  parseClaudeCodeVersionFromRunTs,
} from "../scripts/claude-review/install-claude-code.mjs";

const FIXTURE = `
export async function installClaudeCode() {
  const claudeCodeVersion = "2.1.296";
  console.log(claudeCodeVersion);
}
`;

describe("parseClaudeCodeVersionFromRunTs", () => {
  it("extracts the pinned version string", () => {
    assert.equal(parseClaudeCodeVersionFromRunTs(FIXTURE), "2.1.296");
  });

  it("returns null when missing", () => {
    assert.equal(parseClaudeCodeVersionFromRunTs("// no version"), null);
  });
});

describe("downloadClaudeCodeBinary", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function serve(binary, checksum) {
    globalThis.fetch = async (url) => {
      if (url.endsWith("/manifest.json")) {
        return Response.json({ version: "2.1.296", platforms: { "linux-x64": { binary: "claude", checksum } } });
      }
      return new Response(binary);
    };
  }

  it("keeps a binary whose sha256 matches the manifest", async () => {
    const binary = Buffer.from("#!/bin/sh\necho 2.1.296\n");
    serve(binary, createHash("sha256").update(binary).digest("hex"));
    const dir = mkdtempSync(join(tmpdir(), "claude-bin-"));
    const result = await downloadClaudeCodeBinary("2.1.296", dir);
    assert.equal(result.executablePath, join(dir, "claude"));
    assert.equal(result.version, "2.1.296");
  });

  it("rejects a binary whose sha256 does not match", async () => {
    serve(Buffer.from("tampered"), "0".repeat(64));
    const dir = mkdtempSync(join(tmpdir(), "claude-bin-"));
    await assert.rejects(downloadClaudeCodeBinary("2.1.296", dir), /Checksum mismatch/);
  });
});
