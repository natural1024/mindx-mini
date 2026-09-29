import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareRuntimeContext } from "./prepare-mindx-runtime-context.mjs";

test("creates a minimal runtime context from one set of built artifacts", async (t) => {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), "mindx-runtime-test-"),
  );
  t.after(() => rm(workspace, { force: true, recursive: true }));

  const files = {
    ".ci-source/Dockerfile": "FROM node:22-alpine\n",
    ".ci-source/.dockerignore": "node_modules\n",
    "apps/mindx-webserver/package.json": '{"name":"server"}\n',
    "apps/mindx-webserver/package-lock.json": '{"lockfileVersion":3}\n',
    "apps/mindx-webserver/dist/server.js": "console.log('server')\n",
    "apps/mindx/public/server-html/pc.html": "pc\n",
    "apps/mindx/public/server-html/mobile.html": "mobile\n",
    "apps/mindx/public/cdn/js/federation/federation-manifest.json": "{}\n",
    "apps/mindx/public/cdn/js/main.js": "must not enter image\n",
    ".release/mindx-runtime/stale.txt": "stale\n",
  };
  await Promise.all(
    Object.entries(files).map(async ([name, contents]) => {
      const target = path.join(workspace, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }),
  );

  const target = await prepareRuntimeContext({
    dockerfileDir: path.join(workspace, ".ci-source"),
    workspace,
  });

  assert.equal(
    await readFile(path.join(target, "public/pc.html"), "utf8"),
    "pc\n",
  );
  assert.equal(
    await readFile(path.join(target, "dist/server.js"), "utf8"),
    "console.log('server')\n",
  );
  await assert.rejects(readFile(path.join(target, "stale.txt")), /ENOENT/);
  await assert.rejects(
    readFile(path.join(target, "public/js/main.js")),
    /ENOENT/,
  );
});
