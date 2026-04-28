/**
 * File header: Manages the singleton FileStorageClient instance for the worker process.
 */

import { createFileStorageClientFromEnv } from "@ee-library/shared/file-storage";
import type { FileStorageClient } from "@ee-library/shared/file-storage";

let storageClient: FileStorageClient | null = null;

/**
 * Returns the active storage client, creating it from environment variables on first call.
 */
export function getWorkerStorageClient(): FileStorageClient {
  storageClient ??= createFileStorageClientFromEnv();
  return storageClient;
}

/**
 * Replaces the storage client with a test double for enrichment job tests.
 */
export function setWorkerStorageClientForTests(client: FileStorageClient | null): void {
  storageClient = client;
}
