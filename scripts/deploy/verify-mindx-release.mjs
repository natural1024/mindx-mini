#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OGP_RESOURCE_URLS = [
  "https://docs.gtimg.com/mindx/favicon.svg",
  "https://docs.gtimg.com/mindx/icon/wb-file-audio-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-doc-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-drawio-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-html-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-image-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-markdown-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-pdf-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-sheet-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-slide-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-txt-solid.png",
  "https://docs.gtimg.com/mindx/icon/wb-file-video-solid.png",
];

function normalizeBaseUrl(value, name) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return value.replace(/\/+$/, "");
}

function isRepositoryAsset(rawValue, expectedUrl) {
  if (/^(?:data|blob):/i.test(rawValue)) return false;
  const parsed = new URL(rawValue, expectedUrl);
  return (
    !/^https?:/i.test(rawValue) ||
    parsed.origin === new URL(expectedUrl).origin ||
    parsed.pathname.includes("/web/library/")
  );
}

function assertUrlInPrefix(rawValue, expectedBaseUrl, label) {
  const expected = new URL(`${expectedBaseUrl}/`);
  const actual = new URL(rawValue, expected);
  if (
    actual.origin !== expected.origin ||
    !actual.pathname.startsWith(expected.pathname)
  ) {
    throw new Error(
      `${label} is outside expected release prefix ${expectedBaseUrl}: ${actual.href}`,
    );
  }
  return actual;
}

function extractHtmlAssetUrls(html) {
  const urls = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/giu) ?? []) {
    const attribute = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/iu.exec(tag);
    if (attribute?.[2]) urls.push(attribute[2].replaceAll("&amp;", "&"));
  }
  return urls;
}

function extractCssUrls(css) {
  const urls = [];
  const expression = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
  for (const match of css.matchAll(expression)) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function localPathForUrl(url, assetBaseUrl, cdnDir) {
  const parsed = assertUrlInPrefix(url, assetBaseUrl, "asset URL");
  const prefix = new URL(`${assetBaseUrl}/`).pathname;
  const relative = decodeURIComponent(parsed.pathname.slice(prefix.length));
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`asset URL has an unsafe local path: ${url}`);
  }
  return path.join(cdnDir, ...relative.split("/"));
}

async function assertFile(file, label) {
  const fileStat = await stat(file).catch(() => null);
  if (!fileStat?.isFile()) throw new Error(`${label} is missing: ${file}`);
}

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, absolute)));
    else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

export async function inspectLocalRelease({
  assetBaseUrl,
  federationBaseUrl,
  workspace = process.cwd(),
}) {
  assetBaseUrl = normalizeBaseUrl(assetBaseUrl, "asset base URL");
  federationBaseUrl = normalizeBaseUrl(
    federationBaseUrl,
    "federation base URL",
  );
  if (!federationBaseUrl.startsWith(`${assetBaseUrl}/`)) {
    throw new Error("federation base URL must be inside the asset release URL");
  }

  const publicDir = path.join(workspace, "apps/mindx/public");
  const cdnDir = path.join(publicDir, "cdn");
  const htmlFiles = [
    path.join(publicDir, "server-html/pc.html"),
    path.join(publicDir, "server-html/mobile.html"),
  ];
  const manifestFile = path.join(
    cdnDir,
    "js/federation/federation-manifest.json",
  );
  const serverDist = path.join(
    workspace,
    "apps/mindx-webserver/dist/server.js",
  );
  await Promise.all([
    ...htmlFiles.map((file) => assertFile(file, "server HTML")),
    assertFile(manifestFile, "federation manifest"),
    assertFile(serverDist, "webserver dist entry"),
  ]);

  const htmlUrls = [];
  for (const htmlFile of htmlFiles) {
    const html = await readFile(htmlFile, "utf8");
    for (const rawUrl of extractHtmlAssetUrls(html)) {
      if (!isRepositoryAsset(rawUrl, assetBaseUrl)) continue;
      const url = assertUrlInPrefix(rawUrl, assetBaseUrl, "HTML asset URL");
      htmlUrls.push(url.href);
    }
  }
  if (htmlUrls.length === 0)
    throw new Error("server HTML contains no release assets");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(`federation manifest is invalid JSON: ${error.message}`);
  }
  if (manifest?.schemaVersion !== 1 || typeof manifest.releaseId !== "string") {
    throw new Error("federation manifest has an invalid schema or releaseId");
  }
  const expectedEntry = `${federationBaseUrl}/releases/${manifest.releaseId}/remoteEntry.${manifest.releaseId}.js`;
  if (manifest.remote?.entry !== expectedEntry) {
    throw new Error(`federation remote entry must equal ${expectedEntry}`);
  }
  const manifestUrls = [
    manifest.remote.entry,
    ...(Array.isArray(manifest.assets?.js) ? manifest.assets.js : []),
    ...(Array.isArray(manifest.assets?.css) ? manifest.assets.css : []),
  ];
  for (const url of manifestUrls) {
    assertUrlInPrefix(url, federationBaseUrl, "federation asset URL");
  }

  const directUrls = [...new Set([...htmlUrls, ...manifestUrls])].sort();
  await Promise.all(
    directUrls.map((url) =>
      assertFile(
        localPathForUrl(url, assetBaseUrl, cdnDir),
        `local asset for ${url}`,
      ),
    ),
  );

  const cssUrls = directUrls.filter((url) =>
    new URL(url).pathname.endsWith(".css"),
  );
  const cssAssetUrls = [];
  for (const cssUrl of cssUrls) {
    const cssFile = localPathForUrl(cssUrl, assetBaseUrl, cdnDir);
    const css = await readFile(cssFile, "utf8");
    for (const rawUrl of extractCssUrls(css)) {
      if (!isRepositoryAsset(rawUrl, cssUrl)) continue;
      const resolved = assertUrlInPrefix(
        new URL(rawUrl, cssUrl).href,
        assetBaseUrl,
        "CSS asset URL",
      );
      cssAssetUrls.push(resolved.href);
      await assertFile(
        localPathForUrl(resolved.href, assetBaseUrl, cdnDir),
        `local CSS asset for ${resolved.href}`,
      );
    }
  }

  const cdnFiles = await walkFiles(cdnDir);
  const requiredUrls = [...new Set([...directUrls, ...cssAssetUrls])].sort();
  return {
    assetBaseUrl,
    cdnFiles,
    federationBaseUrl,
    releaseId: manifest.releaseId,
    requiredUrls,
  };
}

export function parseCoscmdListing(contents, remotePrefix) {
  const normalizedPrefix = `${remotePrefix.replace(/^\/+|\/+$/g, "")}/`;
  const files = new Set();
  for (const line of contents.split(/\r?\n/u)) {
    const token = line
      .trim()
      .split(/\s+/u)
      .map((part) => part.replace(/^\/+/, ""))
      .findLast((part) => part.startsWith(normalizedPrefix));
    if (!token) continue;
    const relative = token.slice(normalizedPrefix.length).replace(/\/+$/, "");
    if (relative) files.add(relative);
  }
  return [...files].sort();
}

export function compareRemoteListing(localFiles, remoteFiles, label) {
  const local = new Set(localFiles);
  const remote = new Set(remoteFiles);
  const missing = [...local].filter((file) => !remote.has(file)).sort();
  const extra = [...remote].filter((file) => !local.has(file)).sort();
  if (missing.length || extra.length) {
    const details = [
      missing.length ? `missing remotely: ${missing.join(", ")}` : "",
      extra.length ? `unexpected remotely: ${extra.join(", ")}` : "",
    ].filter(Boolean);
    throw new Error(
      `${label} does not match local CDN files; ${details.join("; ")}`,
    );
  }
}

async function mapWithConcurrency(values, concurrency, task) {
  const output = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        output[index] = await task(values[index]);
      }
    }),
  );
  return output;
}

const defaultSleep = (durationMs) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

export async function headUrlsWithRetry(
  urls,
  {
    concurrency = 24,
    deadlineMs = 300_000,
    fetchImpl = fetch,
    maxAttempts = 6,
    requestTimeoutMs = 15_000,
    retryDelayMs = 10_000,
    sleep = defaultSleep,
  } = {},
) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + deadlineMs;
  let failures = [...new Set(urls)].sort();
  for (
    let attempt = 1;
    attempt <= maxAttempts && failures.length > 0;
    attempt++
  ) {
    const current = failures;
    const results = await mapWithConcurrency(
      current,
      concurrency,
      async (url) => {
        const remainingMs = deadlineAt - Date.now();
        if (remainingMs <= 0) return url;
        try {
          const response = await fetchImpl(url, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(
              Math.min(requestTimeoutMs, remainingMs),
            ),
          });
          return response.status >= 200 && response.status < 300 ? null : url;
        } catch {
          return url;
        }
      },
    );
    failures = results.filter(Boolean);
    console.log(
      `HEAD attempt ${attempt}: total=${current.length} success=${current.length - failures.length} failed=${failures.length}`,
    );
    if (failures.length === 0 || attempt === maxAttempts) break;
    if (Date.now() + retryDelayMs >= deadlineAt) break;
    await sleep(retryDelayMs);
  }
  return failures.sort();
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { remoteLists: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument near ${flag ?? "end of command"}`);
    }
    const key = flag.slice(2);
    if (key === "remote-list") options.remoteLists.push(value);
    else
      options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] =
        value;
  }
  return { command, options };
}

async function verifyOgpResources() {
  const failures = await headUrlsWithRetry(OGP_RESOURCE_URLS, {
    maxAttempts: 2,
    retryDelayMs: 2_000,
  });
  if (failures.length > 0) {
    console.warn(
      `OGP resource warning (${failures.length}):\n${failures.join("\n")}`,
    );
  } else {
    console.log(`OGP resources reachable: ${OGP_RESOURCE_URLS.length}`);
  }
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "local") {
    if (!options.assetBaseUrl || !options.federationBaseUrl) {
      throw new Error(
        "local verification requires --asset-base-url and --federation-base-url",
      );
    }
    const metadata = await inspectLocalRelease({
      assetBaseUrl: options.assetBaseUrl,
      federationBaseUrl: options.federationBaseUrl,
      workspace: options.workspace,
    });
    const output = options.output ?? ".release/mindx-release.json";
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`);
    await writeFile(
      path.join(path.dirname(output), "mindx-cdn-files.txt"),
      `${metadata.cdnFiles.join("\n")}\n`,
    );
    console.log(
      `Local release verified: releaseId=${metadata.releaseId} requiredUrls=${metadata.requiredUrls.length} cdnFiles=${metadata.cdnFiles.length}`,
    );
    return;
  }
  if (command === "remote") {
    if (
      !options.metadata ||
      options.remoteLists.length === 0 ||
      !options.remotePrefix
    ) {
      throw new Error(
        "remote verification requires --metadata, --remote-prefix, and at least one --remote-list",
      );
    }
    const metadata = JSON.parse(await readFile(options.metadata, "utf8"));
    for (const listFile of options.remoteLists) {
      const remoteFiles = parseCoscmdListing(
        await readFile(listFile, "utf8"),
        options.remotePrefix,
      );
      compareRemoteListing(metadata.cdnFiles, remoteFiles, listFile);
      console.log(
        `Remote listing verified: ${listFile} (${remoteFiles.length} files)`,
      );
    }
    const failures = await headUrlsWithRetry(metadata.requiredUrls);
    if (failures.length > 0) {
      throw new Error(`CDN HEAD verification failed:\n${failures.join("\n")}`);
    }
    console.log(
      `Public CDN verified: releaseId=${metadata.releaseId} urls=${metadata.requiredUrls.length}`,
    );
    await verifyOgpResources();
    return;
  }
  if (command === "ogp") {
    await verifyOgpResources();
    return;
  }
  throw new Error(
    "usage: verify-mindx-release.mjs <local|remote|ogp> [options]",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
