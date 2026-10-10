/** @typedef {"must_fix" | "should_fix"} FindingSeverity */

/** @typedef {{ id?: string, severity: FindingSeverity, path: string, line: number, category: string, text: string, rawLine: string }} ParsedFinding */

const FINDING_LINE = /^- (?:\[(F\d+)\] )?([^:[\s]+):(\d+) \[([^\]]+)\]: (.*)$/;
const FIXED_LINE = /^Fixed: (F\d+)\b/;

export function parseFindingLine(line, severity) {
  const m = line.match(FINDING_LINE);
  if (!m) return null;
  return {
    id: m[1],
    severity,
    path: m[2],
    line: Number(m[3]),
    category: m[4],
    text: m[5],
    rawLine: line,
  };
}

export function parseFixedIds(body) {
  const ids = [];
  for (const line of body.split("\n")) {
    const m = line.trim().match(FIXED_LINE);
    if (m) ids.push(m[1]);
  }
  return ids;
}

export function extractFindingsFromBody(body) {
  /** @type {ParsedFinding[]} */
  const out = [];
  /** @type {FindingSeverity | null} */
  let section = null;
  for (const line of body.split("\n")) {
    if (line.startsWith("## Issues (Must Fix)")) {
      section = "must_fix";
      continue;
    }
    if (line.startsWith("## Suggestions (Should Fix)")) {
      section = "should_fix";
      continue;
    }
    if (line.startsWith("## ") && !line.includes("Must Fix") && !line.includes("Should Fix")) {
      section = null;
      continue;
    }
    if (!section || !line.startsWith("- ")) continue;
    const parsed = parseFindingLine(line, section);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function findingMatchKey(f) {
  return `${f.path}:${f.line}:${f.category}`;
}

export function nextFindingId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const n = Number(id.replace(/^F/, ""));
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `F${max + 1}`;
}

export function assignFindingIds(body, priorBody, explicitFixedIds = []) {
  const priorFindings = extractFindingsFromBody(priorBody);
  const priorByKey = new Map();
  for (const f of priorFindings) {
    if (f.id) priorByKey.set(findingMatchKey(f), f.id);
  }

  const fixedSet = new Set([...explicitFixedIds, ...parseFixedIds(body)]);
  const usedIds = new Set(priorFindings.map((f) => f.id).filter(Boolean));
  const lines = body.split("\n");
  const outLines = [];
  /** @type {FindingSeverity | null} */
  let section = null;
  /** @type {ParsedFinding[]} */
  const assigned = [];

  for (const line of lines) {
    if (line.startsWith("## Issues (Must Fix)")) {
      section = "must_fix";
      outLines.push(line);
      continue;
    }
    if (line.startsWith("## Suggestions (Should Fix)")) {
      section = "should_fix";
      outLines.push(line);
      continue;
    }
    if (line.startsWith("## ") && !line.includes("Must Fix") && !line.includes("Should Fix")) {
      section = null;
      outLines.push(line);
      continue;
    }

    if (section && line.startsWith("- ")) {
      const parsed = parseFindingLine(line, section);
      if (parsed) {
        let id = parsed.id;
        if (!id) id = priorByKey.get(findingMatchKey(parsed));
        if (!id) id = nextFindingId([...usedIds]);
        usedIds.add(id);
        const stamped = `- [${id}] ${parsed.path}:${parsed.line} [${parsed.category}]: ${parsed.text}`;
        outLines.push(stamped);
        assigned.push({ ...parsed, id, rawLine: stamped });
        continue;
      }
    }
    outLines.push(line);
  }

  const currentKeys = new Set(assigned.map((f) => findingMatchKey(f)));
  /** @type {string[]} */
  const fixedIds = [];
  for (const f of priorFindings) {
    if (!f.id) continue;
    if (fixedSet.has(f.id)) {
      fixedIds.push(f.id);
      continue;
    }
    if (!currentKeys.has(findingMatchKey(f))) fixedIds.push(f.id);
  }

  return {
    findings: assigned,
    fixedIds: [...new Set(fixedIds)],
    body: outLines.join("\n"),
  };
}

export function extractOpenFindingsForPrompt(body) {
  return extractFindingsFromBody(body)
    .filter((f) => f.severity === "must_fix")
    .map((f) => (f.id ? `- [${f.id}] ${f.path}:${f.line} [${f.category}]: ${f.text}` : f.rawLine))
    .join("\n");
}
