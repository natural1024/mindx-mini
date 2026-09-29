import { createHash } from "node:crypto";

const ISSUE_ID_KEYS = new Set(["iid", "number", "issue_iid", "issueIid"]);

function positiveIssueId(value) {
  const issueId = Number(value);
  return Number.isSafeInteger(issueId) && issueId > 0 ? issueId : null;
}

function findIssueId(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findIssueId(item);
      if (found) return found;
    }
    return null;
  }
  for (const [key, item] of Object.entries(value)) {
    if (ISSUE_ID_KEYS.has(key)) {
      const found = positiveIssueId(item);
      if (found) return found;
    }
  }
  for (const item of Object.values(value)) {
    const found = findIssueId(item);
    if (found) return found;
  }
  return null;
}

export function parseCreatedIssueId(output) {
  const text = String(output || "");
  for (const line of text.split(/\r?\n/u)) {
    try {
      const found = findIssueId(JSON.parse(line));
      if (found) return found;
    } catch {
      // CNB may prefix a version line or emit a non-JSON status line.
    }
  }
  const keyed = text.match(
    /(?:^|[,{;\s])["']?(?:iid|number|issue_iid|issueIid)["']?\s*[:=]\s*["']?([1-9]\d*)/u,
  );
  if (keyed) return Number(keyed[1]);
  const url = text.match(/\/issues\/([1-9]\d*)(?:\D|$)/u);
  return url ? Number(url[1]) : null;
}

export function issueBodyDigest(body) {
  return createHash("sha256")
    .update(String(body || ""), "utf8")
    .digest("hex");
}

function normalizedLabels(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((label) => (typeof label === "string" ? label : label?.name))
    .filter((label) => typeof label === "string")
    .sort();
}

function sameLabels(left, right) {
  return (
    JSON.stringify(normalizedLabels(left)) ===
    JSON.stringify(normalizedLabels(right))
  );
}

function candidateCreatedAt(candidate) {
  const timestamp = Date.parse(
    candidate?.createdAt || candidate?.created_at || candidate?.created || "",
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

function issueAuthor(issue) {
  return issue?.author?.username || issue?.author || issue?.owner;
}

function issueDetailId(issue) {
  return positiveIssueId(issue?.iid ?? issue?.number ?? issue?.id);
}

function assertExpectedIssueIdentity(expected) {
  if (
    typeof expected?.title !== "string" ||
    typeof expected?.body !== "string" ||
    typeof expected?.author !== "string" ||
    !Array.isArray(expected?.labels)
  ) {
    throw new Error(
      "Issue creation identity requires the complete expected title, body, labels and author",
    );
  }
}

export function assertCreatedIssueDetail({ issueId, detail, expected }) {
  assertExpectedIssueIdentity(expected);
  const mismatches = [];
  if (issueDetailId(detail) !== positiveIssueId(issueId)) {
    mismatches.push("iid");
  }
  if (detail?.title !== expected?.title) {
    mismatches.push("title");
  }
  if (
    issueBodyDigest(detail?.body ?? detail?.description) !==
    issueBodyDigest(expected?.body)
  ) {
    mismatches.push("body");
  }
  if (!sameLabels(detail?.labels, expected?.labels)) {
    mismatches.push("labels");
  }
  if (issueAuthor(detail) !== expected?.author) {
    mismatches.push("author");
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Created Issue #${issueId} detail does not match the create request: ${mismatches.join(", ")}`,
    );
  }
  return detail;
}

export function resolveCreatedIssueIdentity({
  createOutput,
  responseIssueDetail,
  candidates = [],
  expected,
  startedAt,
  endedAt,
  clockSkewMs = 5_000,
  responseLagMs = 30_000,
}) {
  assertExpectedIssueIdentity(expected);
  const responseIssueId = parseCreatedIssueId(createOutput);
  if (responseIssueId) {
    if (responseIssueDetail === undefined) {
      return { status: "DETAIL_REQUIRED", issueId: responseIssueId };
    }
    assertCreatedIssueDetail({
      issueId: responseIssueId,
      detail: responseIssueDetail,
      expected,
    });
    return { status: "RESPONSE_ID", issueId: responseIssueId };
  }
  const start = Number(startedAt);
  const end = Number(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(
      "Issue creation recovery requires a bounded call time window",
    );
  }
  const expectedDigest = issueBodyDigest(expected.body);
  const matches = candidates.filter((candidate) => {
    const createdAt = candidateCreatedAt(candidate);
    return (
      createdAt !== null &&
      createdAt >= start - clockSkewMs &&
      createdAt <= end + responseLagMs &&
      candidate.title === expected.title &&
      issueAuthor(candidate) === expected.author &&
      issueBodyDigest(candidate.body || candidate.description) ===
        expectedDigest &&
      sameLabels(candidate.labels, expected.labels)
    );
  });
  if (matches.length === 1) {
    const issueId = positiveIssueId(
      matches[0].iid ?? matches[0].number ?? matches[0].id,
    );
    return issueId
      ? { status: "FINGERPRINT_MATCH", issueId }
      : { status: "NOT_FOUND" };
  }
  if (matches.length > 1) {
    return {
      status: "AMBIGUOUS",
      issueIds: matches
        .map((candidate) =>
          positiveIssueId(candidate.iid ?? candidate.number ?? candidate.id),
        )
        .filter(Boolean),
    };
  }
  return { status: "NOT_FOUND" };
}
