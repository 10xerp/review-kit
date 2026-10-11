/** @typedef {"must_fix" | "should_fix"} FindingSeverity */

/** @typedef {{ id?: string, severity: FindingSeverity, path: string, line: number, category: string, text: string, rawLine: string }} ParsedFinding */

const FINDING_LINE = /^- (?:\[(F\d+)\] )?([^:[\s]+):(\d+) \[([^\]]+)\]: (.*)$/;
const RESOLVED_LINE = /^(Fixed|Dismissed): (F\d+)\b/;
const ISSUES_HEADING = "## Issues (Must Fix)";
const SUGGESTIONS_HEADING = "## Suggestions (Should Fix)";
const CARRIED_NOTE = " (still open from an earlier review)";

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

/** `Fixed: F#` and `Dismissed: F#` lines, which are the only ways to close a Must Fix. */
export function parseResolvedIds(body) {
  const fixed = [];
  const dismissed = [];
  for (const line of body.split("\n")) {
    const m = line.trim().match(RESOLVED_LINE);
    if (!m) continue;
    (m[1] === "Fixed" ? fixed : dismissed).push(m[2]);
  }
  return { fixed, dismissed };
}

export function parseFixedIds(body) {
  return parseResolvedIds(body).fixed;
}

function sectionFor(line) {
  if (line.startsWith(ISSUES_HEADING)) return "must_fix";
  if (line.startsWith(SUGGESTIONS_HEADING)) return "should_fix";
  if (line.startsWith("## ")) return null;
  return undefined;
}

export function extractFindingsFromBody(body) {
  /** @type {ParsedFinding[]} */
  const out = [];
  /** @type {FindingSeverity | null} */
  let section = null;
  for (const line of body.split("\n")) {
    const next = sectionFor(line);
    if (next !== undefined) {
      section = next;
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

function idNumber(id) {
  const n = Number(String(id ?? "").replace(/^F/, ""));
  return Number.isNaN(n) ? 0 : n;
}

export function maxFindingId(ids) {
  let max = 0;
  for (const id of ids) max = Math.max(max, idNumber(id));
  return max;
}

export function nextFindingId(existingIds) {
  return `F${maxFindingId(existingIds) + 1}`;
}

function stampLine(f) {
  return `- [${f.id}] ${f.path}:${f.line} [${f.category}]: ${f.text}`;
}

/**
 * Inserts the carried-forward Must Fix lines under the Issues heading, creating the section
 * right after the verdict and any Fixed/Dismissed lines when the review has none.
 */
function insertCarried(lines, carriedLines) {
  const out = [...lines];
  const heading = out.findIndex((l) => l.startsWith(ISSUES_HEADING));
  if (heading >= 0) {
    let end = heading + 1;
    while (end < out.length && !out[end].startsWith("## ")) end++;
    while (end > heading + 1 && out[end - 1].trim() === "") end--;
    out.splice(end, 0, ...carriedLines);
    return out;
  }
  let at = out.findIndex((l) => l.startsWith("## "));
  if (at < 0) {
    while (out.length && out.at(-1).trim() === "") out.pop();
    at = out.length;
  }
  out.splice(at, 0, "", ISSUES_HEADING, ...carriedLines, "");
  return out;
}

/**
 * Stamps a stable ID on every finding line. IDs continue from `maxId` (the highest ID ever used
 * on this PR, kept in the comment metadata) so a review with no findings does not reset them.
 *
 * A Must Fix from the previous review closes only through an explicit `Fixed: F#` or
 * `Dismissed: F#` line. One that the new review neither closes nor re-lists is carried forward
 * under Issues, so an unrelated push can never clear a Blocked verdict by itself. Suggestions
 * that are not re-listed are simply dropped, as the standards ask the model not to repeat them.
 */
export function assignFindingIds(body, priorBody, { explicitFixedIds = [], maxId = 0 } = {}) {
  const priorFindings = extractFindingsFromBody(priorBody);
  const priorById = new Map();
  const priorByKey = new Map();
  for (const f of priorFindings) {
    if (!f.id) continue;
    priorById.set(f.id, f);
    priorByKey.set(findingMatchKey(f), f.id);
  }

  const resolved = parseResolvedIds(body);
  const fixedSet = new Set([...explicitFixedIds, ...resolved.fixed]);
  const dismissedSet = new Set(resolved.dismissed);
  let highest = Math.max(maxId, maxFindingId(priorById.keys()));
  const lines = body.split("\n");
  const outLines = [];
  /** @type {FindingSeverity | null} */
  let section = null;
  /** @type {ParsedFinding[]} */
  const assigned = [];
  const taken = new Set();

  for (const line of lines) {
    const next = sectionFor(line);
    if (next !== undefined) {
      section = next;
      outLines.push(line);
      continue;
    }
    if (section && line.startsWith("- ")) {
      const parsed = parseFindingLine(line, section);
      if (parsed) {
        let id = parsed.id && priorById.has(parsed.id) ? parsed.id : undefined;
        if (!id) id = priorByKey.get(findingMatchKey(parsed));
        if (!id || taken.has(id)) {
          highest += 1;
          id = `F${highest}`;
        }
        taken.add(id);
        const stamped = stampLine({ ...parsed, id });
        outLines.push(stamped);
        assigned.push({ ...parsed, id, rawLine: stamped });
        continue;
      }
    }
    outLines.push(line);
  }

  /** @type {string[]} */
  const fixedIds = [];
  /** @type {string[]} */
  const dismissedIds = [];
  /** @type {ParsedFinding[]} */
  const carried = [];
  for (const f of priorFindings) {
    if (!f.id || taken.has(f.id)) continue;
    if (dismissedSet.has(f.id)) {
      dismissedIds.push(f.id);
    } else if (fixedSet.has(f.id)) {
      fixedIds.push(f.id);
    } else if (f.severity === "must_fix") {
      const text = f.text.endsWith(CARRIED_NOTE) ? f.text : `${f.text}${CARRIED_NOTE}`;
      const line = stampLine({ ...f, text });
      carried.push({ ...f, text, rawLine: line });
      taken.add(f.id);
    } else {
      fixedIds.push(f.id);
    }
  }

  const finalLines = carried.length ? insertCarried(outLines, carried.map((f) => f.rawLine)) : outLines;
  return {
    findings: [...assigned, ...carried],
    fixedIds: [...new Set(fixedIds)],
    dismissedIds: [...new Set(dismissedIds)],
    carriedIds: carried.map((f) => f.id),
    maxId: highest,
    body: finalLines.join("\n"),
  };
}

export function extractOpenFindingsForPrompt(body) {
  return extractFindingsFromBody(body)
    .filter((f) => f.severity === "must_fix")
    .map((f) => (f.id ? stampLine(f) : f.rawLine))
    .join("\n");
}
