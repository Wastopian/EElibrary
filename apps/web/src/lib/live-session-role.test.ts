/**
 * File header: Tests live session role reads used to enforce demotion without re-login.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readLiveSessionRole } from "./live-session-role";

test("readLiveSessionRole returns the persisted role and org for an existing user", async () => {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [{ orgId: "org-acme", role: "user" }]
              };
            }
          };
        }
      };
    }
  };

  assert.deepEqual(await readLiveSessionRole("user-1", db as never), {
    orgId: "org-acme",
    role: "user"
  });
});

test("readLiveSessionRole fails closed when the account is missing or the role is invalid", async () => {
  const missing = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => []
              };
            }
          };
        }
      };
    }
  };
  const invalidRole = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [{ orgId: "org-acme", role: "approver" }]
              };
            }
          };
        }
      };
    }
  };

  assert.equal(await readLiveSessionRole("missing", missing as never), null);
  assert.equal(await readLiveSessionRole("bad-role", invalidRole as never), null);
});

test("readLiveSessionRole defaults a null org_id to org-default", async () => {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit: async () => [{ orgId: null, role: "admin" }]
              };
            }
          };
        }
      };
    }
  };

  assert.deepEqual(await readLiveSessionRole("legacy", db as never), {
    orgId: "org-default",
    role: "admin"
  });
});
