/**
 * File header: Pure validation for the local-dev environment variables. Returns a structured
 * list of issues so callers (with-local-env, setup:dev, smoke:local) can fail loudly with
 * actionable copy instead of presenting a generic "API unavailable" state to the user.
 */

/** AUTH_SECRET_MIN_LENGTH is the minimum acceptable length for the local AUTH_SECRET. */
export const AUTH_SECRET_MIN_LENGTH = 32;

/** RequiredEnvKey lists the variables every local dev process is expected to have. */
export const REQUIRED_ENV_KEYS = ["DATABASE_URL", "AUTH_SECRET", "EE_LIBRARY_API_BASE_URL"];

/** EnvIssue describes one validation problem with a fix suggestion. */
export class EnvIssue {
  constructor({ key, message, fix }) {
    this.key = key;
    this.message = message;
    this.fix = fix;
  }
}

/**
 * Validates the loaded environment for local dev. Returns an array of EnvIssue values;
 * an empty array means the env is good to go.
 */
export function validateLocalEnv(env = process.env) {
  const issues = [];

  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === "") {
    issues.push(
      new EnvIssue({
        fix: "Run `npm run setup:dev` to copy .env.example to .env, or export DATABASE_URL=postgres://ee_library:ee_library@localhost:5432/ee_library",
        key: "DATABASE_URL",
        message: "DATABASE_URL is missing. The API will run with seed-fallback data and the worker daemon cannot start."
      })
    );
  } else {
    try {
      const parsed = new URL(env.DATABASE_URL);
      if (!parsed.protocol.startsWith("postgres")) {
        issues.push(
          new EnvIssue({
            fix: "DATABASE_URL must start with postgres:// or postgresql://",
            key: "DATABASE_URL",
            message: `DATABASE_URL has unexpected protocol "${parsed.protocol}".`
          })
        );
      }
    } catch {
      issues.push(
        new EnvIssue({
          fix: "Set DATABASE_URL to a parseable URL such as postgres://ee_library:ee_library@localhost:5432/ee_library",
          key: "DATABASE_URL",
          message: "DATABASE_URL could not be parsed as a URL."
        })
      );
    }
  }

  const authSecret = env.AUTH_SECRET ?? "";
  if (authSecret.length === 0) {
    issues.push(
      new EnvIssue({
        fix: "Run `npm run setup:dev` (it generates one) or set AUTH_SECRET to a 32+ char random string.",
        key: "AUTH_SECRET",
        message: "AUTH_SECRET is missing. Future session/cookie signing will refuse to start."
      })
    );
  } else if (authSecret.length < AUTH_SECRET_MIN_LENGTH) {
    issues.push(
      new EnvIssue({
        fix: `Use \`npm run setup:dev\` to regenerate, or replace with a value of at least ${AUTH_SECRET_MIN_LENGTH} characters.`,
        key: "AUTH_SECRET",
        message: `AUTH_SECRET is only ${authSecret.length} characters; minimum is ${AUTH_SECRET_MIN_LENGTH}.`
      })
    );
  }

  const apiBaseUrl = env.EE_LIBRARY_API_BASE_URL ?? "";
  if (apiBaseUrl.trim() === "") {
    issues.push(
      new EnvIssue({
        fix: "Set EE_LIBRARY_API_BASE_URL=http://127.0.0.1:4000 in .env or run `npm run setup:dev`.",
        key: "EE_LIBRARY_API_BASE_URL",
        message: "EE_LIBRARY_API_BASE_URL is missing. The web app cannot reach the API service."
      })
    );
  } else {
    try {
      const parsed = new URL(apiBaseUrl);
      if (!/^https?:$/u.test(parsed.protocol)) {
        issues.push(
          new EnvIssue({
            fix: "EE_LIBRARY_API_BASE_URL must be an http(s) URL.",
            key: "EE_LIBRARY_API_BASE_URL",
            message: `EE_LIBRARY_API_BASE_URL has unexpected protocol "${parsed.protocol}".`
          })
        );
      }
    } catch {
      issues.push(
        new EnvIssue({
          fix: "Set EE_LIBRARY_API_BASE_URL to a parseable URL such as http://127.0.0.1:4000",
          key: "EE_LIBRARY_API_BASE_URL",
          message: "EE_LIBRARY_API_BASE_URL could not be parsed."
        })
      );
    }
  }

  return issues;
}

/**
 * Formats a list of EnvIssue values as a human-readable block of text suitable for stderr.
 */
export function formatIssuesForStderr(issues) {
  if (issues.length === 0) {
    return "";
  }
  const lines = ["Local environment is missing required values:", ""];
  for (const issue of issues) {
    lines.push(`  - ${issue.key}: ${issue.message}`);
    lines.push(`    fix: ${issue.fix}`);
  }
  lines.push("");
  return lines.join("\n");
}
