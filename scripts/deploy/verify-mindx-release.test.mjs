import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareRemoteListing,
  headUrlsWithRetry,
  inspectLocalRelease,
  parseCoscmdListing,
} from "./verify-mindx-release.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const ASSET_BASE = `https://static.workbuddy.cn/web/library/${SHA}`;
const FEDERATION_BASE = `${ASSET_BASE}/js/federation`;
const RELEASE_ID = "fedcba9876543210";

async function createReleaseFixture(assetBase = ASSET_BASE) {
  const federationBase = `${assetBase}/js/federation`;
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "mindx-release-test-"),
  );
  const files = {
    "apps/mindx/public/server-html/pc.html": `
      <html><head>
        <link rel="icon" href="${assetBase}/favicon.svg">
        <link rel="stylesheet" href="${assetBase}/css/main.css">
        <script defer src="${assetBase}/js/main.js"></script>
      </head></html>`,
    "apps/mindx/public/server-html/mobile.html": `
      <html><head><script src='${assetBase}/js/mobile.js'></script></head></html>`,
    "apps/mindx/public/cdn/favicon.svg": "icon",
    "apps/mindx/public/cdn/js/main.js": "main",
    "apps/mindx/public/cdn/js/mobile.js": "mobile",
    "apps/mindx/public/cdn/css/main.css":
      "@font-face { src: url('../image/font.woff2') }",
    "apps/mindx/public/cdn/image/font.woff2": "font",
    [`apps/mindx/public/cdn/js/federation/releases/${RELEASE_ID}/remoteEntry.${RELEASE_ID}.js`]:
      "remote",
    [`apps/mindx/public/cdn/js/federation/releases/${RELEASE_ID}/chunk.js`]:
      "chunk",
    [`apps/mindx/public/cdn/js/federation/releases/${RELEASE_ID}/chunk.css`]:
      "chunk css",
    "apps/mindx-webserver/dist/server.js": "server",
  };
  const manifest = {
    schemaVersion: 1,
    releaseId: RELEASE_ID,
    remote: {
      name: "library",
      entry: `${federationBase}/releases/${RELEASE_ID}/remoteEntry.${RELEASE_ID}.js`,
    },
    assets: {
      js: [`${federationBase}/releases/${RELEASE_ID}/chunk.js`],
      css: [`${federationBase}/releases/${RELEASE_ID}/chunk.css`],
    },
  };
  files["apps/mindx/public/cdn/js/federation/federation-manifest.json"] =
    JSON.stringify(manifest);

  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const target = path.join(workspace, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }),
  );
  return workspace;
}

test("validates HTML, manifest, and CSS URL references against local files", async (t) => {
  const workspace = await createReleaseFixture();
  t.after(() => rm(workspace, { force: true, recursive: true }));

  const metadata = await inspectLocalRelease({
    assetBaseUrl: ASSET_BASE,
    federationBaseUrl: FEDERATION_BASE,
    workspace,
  });

  assert.equal(metadata.releaseId, RELEASE_ID);
  assert(metadata.requiredUrls.includes(`${ASSET_BASE}/image/font.woff2`));
  assert(metadata.cdnFiles.includes("js/federation/federation-manifest.json"));
});

test("rejects an HTML asset that escapes the immutable commit prefix", async (t) => {
  const workspace = await createReleaseFixture();
  t.after(() => rm(workspace, { force: true, recursive: true }));
  await writeFile(
    path.join(workspace, "apps/mindx/public/server-html/pc.html"),
    '<script src="https://download.codebuddy.cn/web/library/js/main.js"></script>',
  );

  await assert.rejects(
    inspectLocalRelease({
      assetBaseUrl: ASSET_BASE,
      federationBaseUrl: FEDERATION_BASE,
      workspace,
    }),
    /outside expected release prefix/,
  );
});

test("parses real coscmd paths and requires an exact remote file set", () => {
  const listing = parseCoscmdListing(
    [
      "web/library/abc/js/main.js   10   STANDARD   2026-09-03 12:00:00",
      "/web/library/abc/css/main.css   20   STANDARD   2026-09-03 12:00:00",
      "web/library/other/js/unrelated.js   30   STANDARD   2026-09-03 12:00:00",
    ].join("\n"),
    "/web/library/abc/",
  );
  assert.deepEqual(listing, ["css/main.css", "js/main.js"]);
  assert.doesNotThrow(() =>
    compareRemoteListing(
      ["js/main.js", "css/main.css"],
      listing,
      "primary bucket",
    ),
  );
  assert.throws(
    () => compareRemoteListing(["js/main.js", "missing.js"], listing, "bucket"),
    /missing remotely: missing.js/,
  );
});

test("bounded HEAD retries only revisit the previous failure set", async () => {
  const calls = new Map();
  const fetchImpl = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    const shouldFail = url.endsWith("retry.js") && calls.get(url) === 1;
    return new Response(null, { status: shouldFail ? 503 : 200 });
  };

  const failures = await headUrlsWithRetry(
    ["https://cdn.test/ok.js", "https://cdn.test/retry.js"],
    {
      fetchImpl,
      maxAttempts: 3,
      retryDelayMs: 0,
      sleep: async () => {},
    },
  );

  assert.deepEqual(failures, []);
  assert.equal(calls.get("https://cdn.test/ok.js"), 1);
  assert.equal(calls.get("https://cdn.test/retry.js"), 2);
});

test("international HTML, CSS and Federation assets stay in the international release", async (t) => {
  const assetBaseUrl = `https://download.codebuddy.ai/web/library/${SHA}`;
  const federationBaseUrl = `${assetBaseUrl}/js/federation`;
  const workspace = await createReleaseFixture(assetBaseUrl);
  t.after(() => rm(workspace, { force: true, recursive: true }));
  const metadata = await inspectLocalRelease({
    assetBaseUrl,
    federationBaseUrl,
    workspace,
  });
  assert(
    metadata.requiredUrls.every((url) => url.startsWith(`${assetBaseUrl}/`)),
  );
  assert(metadata.requiredUrls.includes(`${assetBaseUrl}/image/font.woff2`));
  await writeFile(
    path.join(workspace, "apps/mindx/public/cdn/css/main.css"),
    `@font-face { src: url('${ASSET_BASE}/image/font.woff2') }`,
  );
  await assert.rejects(
    inspectLocalRelease({ assetBaseUrl, federationBaseUrl, workspace }),
    /outside expected release prefix/,
  );
});
