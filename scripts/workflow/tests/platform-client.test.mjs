import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformClient,
  PlatformClientError,
} from "../platform-client.mjs";

function createClient() {
  return createPlatformClient({
    endpoint: "https://cnb.example/api",
    repo: "x-team/mindx",
    token: "test-token",
  });
}

test("versioned Issue reads feed the exact ETag into conditional label writes", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({ state: "open", labels: ["开发中", "P1"] }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ETag: '"issue-v7"',
          },
        },
      );
    }
    return new Response(JSON.stringify({ labels: ["P1", "待发布"] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const client = createClient();
    const snapshot = await client.getIssueVersioned(418);
    assert.equal(snapshot.version, '"issue-v7"');
    assert.deepEqual(snapshot.issue.labels, ["开发中", "P1"]);

    await client.putIssueLabelsIfMatch(418, ["P1", "待发布"], snapshot.version);

    assert.equal(requests.length, 2);
    assert.equal(requests[1].init.headers["If-Match"], '"issue-v7"');
    assert.deepEqual(JSON.parse(requests[1].init.body), {
      labels: ["P1", "待发布"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conditional Issue label writes reject missing versions without a request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("must not request without an If-Match token");
  };

  try {
    await assert.rejects(
      createClient().putIssueLabelsIfMatch(418, ["待发布"], ""),
      /version|If-Match/u,
    );
    assert.equal(requestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conditional Issue label writes surface 412 and never retry unconditionally", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ message: "stale issue" }), {
      status: 412,
      statusText: "Precondition Failed",
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await assert.rejects(
      createClient().putIssueLabelsIfMatch(418, ["P1", "待发布"], '"issue-v7"'),
      (error) => {
        assert.equal(error instanceof PlatformClientError, true);
        assert.equal(error.details.status, 412);
        return true;
      },
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers["If-Match"], '"issue-v7"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
