function normalizeExecutionMetrics(obj) {
  if (!obj || typeof obj !== "object") return {};
  const duration_ms = typeof obj.duration_ms === "number" ? obj.duration_ms : null;
  const num_turns = typeof obj.num_turns === "number" ? obj.num_turns : null;
  const total_cost_usd = typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : null;
  if (duration_ms == null && num_turns == null && total_cost_usd == null) return {};
  return { duration_ms, num_turns, total_cost_usd };
}

/** Parse claude-code-action execution_file (JSON, NDJSON, or noisy log). */
export function parseExecutionFile(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const fromObject = normalizeExecutionMetrics(
    (() => {
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    })(),
  );
  if (Object.keys(fromObject).length > 0) return fromObject;

  let best = {};
  for (const line of trimmed.split("\n")) {
    const chunk = line.trim();
    if (!chunk.startsWith("{")) continue;
    try {
      const obj = JSON.parse(chunk);
      if (obj.type === "result" || obj.duration_ms != null) {
        best = normalizeExecutionMetrics(obj);
      }
    } catch {
      /* ignore bad lines */
    }
  }
  if (Object.keys(best).length > 0) return best;

  // Pretty-printed multi-line JSON blocks (action logs one result object)
  const resultIdx = trimmed.lastIndexOf('"type": "result"');
  if (resultIdx >= 0) {
    const start = trimmed.lastIndexOf("{", resultIdx);
    if (start >= 0) {
      let depth = 0;
      for (let i = start; i < trimmed.length; i++) {
        const ch = trimmed[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              const obj = JSON.parse(trimmed.slice(start, i + 1));
              const metrics = normalizeExecutionMetrics(obj);
              if (Object.keys(metrics).length > 0) return metrics;
            } catch {
              break;
            }
          }
        }
      }
    }
  }

  const duration_ms = trimmed.match(/"duration_ms"\s*:\s*(\d+)/);
  const num_turns = trimmed.match(/"num_turns"\s*:\s*(\d+)/);
  const total_cost_usd = trimmed.match(/"total_cost_usd"\s*:\s*([0-9.]+)/);
  if (duration_ms || num_turns || total_cost_usd) {
    return {
      duration_ms: duration_ms ? Number(duration_ms[1]) : null,
      num_turns: num_turns ? Number(num_turns[1]) : null,
      total_cost_usd: total_cost_usd ? Number(total_cost_usd[1]) : null,
    };
  }

  return {};
}

export function buildReviewRecord(input) {
  const fixedSet = new Set(input.fixedIds);
  return {
    schema: 1,
    repo: input.repo,
    pr: input.pr,
    base_ref: input.baseRef,
    base_sha: input.baseSha,
    head_sha: input.headSha,
    last_sha: input.lastSha,
    mode: input.mode,
    source: input.source,
    verdict: input.verdict,
    findings: input.findings.map((f) => ({
      id: f.id ?? "",
      severity: f.severity,
      path: f.path,
      line: f.line,
      category: f.category,
      text: f.text,
      status: f.id && fixedSet.has(f.id) ? "fixed" : "open",
    })),
    fixed_ids: input.fixedIds,
    replies: input.replies,
    model: input.model,
    claude_code_version: input.claudeCodeVersion,
    action_sha: input.actionSha,
    standards_sha256: input.standardsSha256,
    run_id: input.runId,
    workflow_run_url: input.workflowRunUrl,
    metrics: {
      duration_ms: input.execution.duration_ms ?? null,
      num_turns: input.execution.num_turns ?? null,
      total_cost_usd: input.execution.total_cost_usd ?? null,
      queue_s: input.queueS,
      wall_s: input.wallS,
      phases: input.phases,
    },
  };
}
