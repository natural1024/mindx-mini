import assert from "node:assert/strict";
import test from "node:test";

import { validateProtectedRefPush } from "../check-protected-ref-push.mjs";

const ZERO = "0".repeat(40);
const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const FROZEN_REF = `refs/tags/prototype-freeze/418-${SHA}`;

function line({
  localRef = SHA,
  localSha = SHA,
  remoteRef = FROZEN_REF,
  remoteSha = ZERO,
} = {}) {
  return `${localRef} ${localSha} ${remoteRef} ${remoteSha}\n`;
}

test("pre-push permits create-only frozen refs whose suffix matches the object", () => {
  assert.deepEqual(validateProtectedRefPush(line()), {
    protectedCreates: 1,
  });
  assert.deepEqual(
    validateProtectedRefPush(
      line({ remoteRef: "refs/heads/feature/418-memory-card" }),
    ),
    { protectedCreates: 0 },
  );
});

test("pre-push rejects frozen ref deletion, update, and mismatched identity", () => {
  assert.throws(
    () => validateProtectedRefPush(line({ localSha: ZERO, remoteSha: SHA })),
    /PROTECTED_FROZEN_REF_DELETE/u,
  );
  assert.throws(
    () =>
      validateProtectedRefPush(line({ localSha: OTHER_SHA, remoteSha: SHA })),
    /PROTECTED_FROZEN_REF_UPDATE/u,
  );
  assert.throws(
    () =>
      validateProtectedRefPush(
        line({
          localSha: OTHER_SHA,
          remoteRef: FROZEN_REF,
          remoteSha: ZERO,
        }),
      ),
    /PROTECTED_FROZEN_REF_IDENTITY/u,
  );
});
