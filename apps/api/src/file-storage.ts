/**
 * File header: Manages the singleton FileStorageClient instance for the API process.
 */

import { createFileStorageClientFromEnv } from "@ee-library/shared/file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

/** Lazily initialized storage client; null until first access. */
let storageClient: FileStorageClient | null = null;

/**
 * Returns the active storage client, creating it from environment variables on first call.
 */
export function getStorageClient(): FileStorageClient {
  storageClient ??= createFileStorageClientFromEnv();

  return storageClient;
}

/**
 * Replaces the storage client with a test double for route tests.
 */
export function setStorageClientForTests(client: FileStorageClient | null): void {
  storageClient = client;
}
