#!/usr/bin/env node
/**
 * CNB platform client for CI scripts.
 *
 * Callers should pass the token appropriate to their event trust boundary.
 * Read-only workflow checks prefer the ephemeral CNB_TOKEN; legacy trusted
 * jobs may still use MINDX_CI_TOKEN as a compatibility fallback.
 */

const DEFAULT_ACCEPT = "application/vnd.cnb.api+json";

export class PlatformClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlatformClientError";
    this.details = details;
  }
}

function stripTrailingSlash(value) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeLabels(issue) {
  const labels = issue?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => {
      if (typeof label === "string") return label;
      if (label && typeof label.name === "string") return label.name;
      return "";
    })
    .filter(Boolean);
}

function normalizeComments(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.comments)) return value.comments;
  return [];
}

function resolveCommentId(comment) {
  return comment?.id ?? comment?.number ?? comment?.comment_id ?? comment?.iid;
}

function normalizeVersionToken(value) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  if (!token || /[\r\n]/u.test(token)) return "";
  return token;
}

function resolveIssueVersion(issue, etag) {
  return (
    normalizeVersionToken(etag) ||
    normalizeVersionToken(issue?.etag) ||
    normalizeVersionToken(issue?.version)
  );
}

export function createPlatformClient(options = {}) {
  const endpoint = stripTrailingSlash(
    options.endpoint || process.env.CNB_API_ENDPOINT || "",
  );
  const repo = options.repo || process.env.CNB_REPO_SLUG || "";
  const token =
    options.token || process.env.CNB_TOKEN || process.env.MINDX_CI_TOKEN || "";

  if (!endpoint) {
    throw new PlatformClientError("Missing CNB_API_ENDPOINT");
  }
  if (!repo) {
    throw new PlatformClientError("Missing CNB_REPO_SLUG");
  }
  if (!token) {
    throw new PlatformClientError("Missing CNB_TOKEN or MINDX_CI_TOKEN");
  }

  async function requestWithMetadata(method, path, body, options = {}) {
    const res = await fetch(`${endpoint}${path}`, {
      method,
      headers: {
        Accept: DEFAULT_ACCEPT,
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      throw new PlatformClientError(`${method} ${path} failed`, {
        status: res.status,
        statusText: res.statusText,
        body: data,
      });
    }

    return {
      data,
      etag: normalizeVersionToken(res.headers.get("etag")),
    };
  }

  async function request(method, path, body, options) {
    const result = await requestWithMetadata(method, path, body, options);
    return result.data;
  }

  return {
    repo,

    request,

    getPR(prIid) {
      return request("GET", `/${repo}/-/pulls/${prIid}`);
    },

    patchPRTitle(prIid, title) {
      return request("PATCH", `/${repo}/-/pulls/${prIid}`, { title });
    },

    getIssue(issueIid) {
      return request("GET", `/${repo}/-/issues/${issueIid}`);
    },

    async getIssueVersioned(issueIid) {
      const { data: issue, etag } = await requestWithMetadata(
        "GET",
        `/${repo}/-/issues/${issueIid}`,
      );
      const version = resolveIssueVersion(issue, etag);
      if (!version) {
        throw new PlatformClientError(
          `GET /${repo}/-/issues/${issueIid} returned no usable Issue version`,
        );
      }
      return { issue, version };
    },

    putIssueLabels(issueIid, labels) {
      return request("PUT", `/${repo}/-/issues/${issueIid}/labels`, {
        labels,
      });
    },

    async putIssueLabelsIfMatch(issueIid, labels, version) {
      const expectedVersion = normalizeVersionToken(version);
      if (!expectedVersion) {
        throw new PlatformClientError(
          "Conditional Issue label write requires a non-empty If-Match version",
        );
      }
      return request(
        "PUT",
        `/${repo}/-/issues/${issueIid}/labels`,
        { labels },
        { headers: { "If-Match": expectedVersion } },
      );
    },

    closeIssue(issueIid) {
      return request("PATCH", `/${repo}/-/issues/${issueIid}`, {
        state: "closed",
      });
    },

    async getIssueNotes(issueIid) {
      return normalizeComments(
        await request("GET", `/${repo}/-/issues/${issueIid}/comments`),
      );
    },

    createIssueNote(issueIid, body) {
      return request("POST", `/${repo}/-/issues/${issueIid}/comments`, {
        body,
      });
    },

    updateIssueNote(issueIid, noteId, body) {
      return request(
        "PATCH",
        `/${repo}/-/issues/${issueIid}/comments/${noteId}`,
        { body },
      );
    },
  };
}

export const platformUtils = {
  normalizeLabels,
  normalizeComments,
  resolveCommentId,
  resolveIssueVersion,
};
