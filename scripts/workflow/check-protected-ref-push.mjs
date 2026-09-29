#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ZERO_SHA = "0".repeat(40);
const FROZEN_REF_PREFIX = "refs/tags/prototype-freeze/";
const FROZEN_REF_PATTERN =
  /^refs\/tags\/prototype-freeze\/([1-9]\d*)-([0-9a-f]{40})$/u;

export class ProtectedRefPushError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProtectedRefPushError";
  }
}

export function validateProtectedRefPush(input) {
  let protectedCreates = 0;
  for (const rawLine of String(input || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/u);
    if (parts.length !== 4) {
      throw new ProtectedRefPushError(
        `PRE_PUSH_INPUT_INVALID: expected four fields, received ${parts.length}`,
      );
    }
    const [, localSha, remoteRef, remoteSha] = parts;
    if (!remoteRef.startsWith(FROZEN_REF_PREFIX)) continue;

    const identity = remoteRef.match(FROZEN_REF_PATTERN);
    if (!identity) {
      throw new ProtectedRefPushError(
        `PROTECTED_FROZEN_REF_NAME: invalid frozen ref ${remoteRef}`,
      );
    }
    if (localSha === ZERO_SHA) {
      throw new ProtectedRefPushError(
        `PROTECTED_FROZEN_REF_DELETE: ${remoteRef} is create-only`,
      );
    }
    if (remoteSha !== ZERO_SHA) {
      throw new ProtectedRefPushError(
        `PROTECTED_FROZEN_REF_UPDATE: ${remoteRef} cannot move or be force-updated`,
      );
    }
    if (localSha !== identity[2]) {
      throw new ProtectedRefPushError(
        `PROTECTED_FROZEN_REF_IDENTITY: ${remoteRef} must point to its SHA suffix`,
      );
    }
    protectedCreates += 1;
  }
  return { protectedCreates };
}

function isDirectExecution() {
  return Boolean(
    process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
  );
}

if (isDirectExecution()) {
  try {
    const result = validateProtectedRefPush(readFileSync(0, "utf8"));
    if (result.protectedCreates > 0) {
      console.log(
        `Protected prototype freeze ref create allowed: ${result.protectedCreates}`,
      );
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
