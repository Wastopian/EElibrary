/**
 * File header: Loads a local .env file into process.env without overwriting existing values.
 */

import { readEnvFile } from "./env-file.mjs";

/**
 * Reads the .env file at envPath and assigns any keys not already in process.env.
 * Existing process.env values win so callers can override via the shell.
 */
export async function loadEnvFile(envPath) {
  const entries = await readEnvFile(envPath);

  for (const [key, value] of entries) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return entries;
}
