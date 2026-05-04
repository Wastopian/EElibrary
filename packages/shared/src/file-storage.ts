/**
 * File header: Defines the provider-neutral file storage abstraction and local filesystem implementation.
 *
 * The local backend stores files under STORAGE_LOCAL_PATH and generates download URLs that point
 * back to the API's own /storage/:key endpoint. In production, swap to an S3-compatible backend
 * by setting STORAGE_BACKEND=s3 (implementation TBD in P3-X).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** FileStorageBackend identifies which storage implementation is active. */
export type FileStorageBackend = "local" | "not_configured";

/** FileStorageClient is the provider-neutral interface for writing and serving stored asset files. */
export interface FileStorageClient {
  /** Active backend type, used for health reporting. */
  readonly backend: FileStorageBackend;
  /**
   * Returns a direct download URL for the given storage key.
   * Returns null when the backend is not configured or the key is invalid.
   */
  getDownloadUrl(storageKey: string): Promise<string | null>;
  /** Writes file content to storage under the given key, creating parent directories as needed. */
  write(storageKey: string, content: Buffer): Promise<void>;
}

/**
 * Resolves a storage key to an absolute filesystem path, rejecting path traversal attempts.
 * Returns null when the key would escape the base directory.
 */
export function resolveStorageKey(basePath: string, storageKey: string): string | null {
  const resolvedBase = resolve(basePath);
  const resolvedFull = resolve(join(basePath, storageKey));

  if (resolvedFull !== resolvedBase && !resolvedFull.startsWith(resolvedBase + sep)) {
    return null;
  }

  return resolvedFull;
}

/** LocalFileStorageClient stores files on the local filesystem under a configured base path. */
class LocalFileStorageClient implements FileStorageClient {
  readonly backend = "local" as const;

  constructor(
    private readonly basePath: string,
    private readonly serveBaseUrl: string
  ) {}

  async getDownloadUrl(storageKey: string): Promise<string | null> {
    if (!resolveStorageKey(this.basePath, storageKey)) {
      return null;
    }

    return `${this.serveBaseUrl}/storage/${encodeURIComponent(storageKey)}`;
  }

  async write(storageKey: string, content: Buffer): Promise<void> {
    const fullPath = resolveStorageKey(this.basePath, storageKey);

    if (!fullPath) {
      throw new Error(`Invalid storage key rejected to prevent path traversal: ${storageKey}`);
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }
}

/** NotConfiguredFileStorageClient is returned when STORAGE_BACKEND is set to an unsupported value. */
class NotConfiguredFileStorageClient implements FileStorageClient {
  readonly backend = "not_configured" as const;

  async getDownloadUrl(): Promise<string | null> {
    return null;
  }

  async write(): Promise<void> {
    throw new Error("File storage is not configured. Set STORAGE_BACKEND=local or a supported backend.");
  }
}

/**
 * Creates a FileStorageClient from environment variables.
 *
 * STORAGE_BACKEND      - "local" (default) | future: "s3"
 * STORAGE_LOCAL_PATH   - Base directory for local storage (default: "./storage")
 * STORAGE_SERVE_BASE_URL - Base URL of the API server used to build download URLs (default: "http://127.0.0.1:4000")
 */
export function createFileStorageClientFromEnv(): FileStorageClient {
  const backend = process.env["STORAGE_BACKEND"] ?? "local";

  if (backend === "local") {
    const basePath = process.env["STORAGE_LOCAL_PATH"] ?? "./storage";
    const serveBaseUrl = (process.env["STORAGE_SERVE_BASE_URL"] ?? "http://127.0.0.1:4000").replace(/\/+$/u, "");

    return new LocalFileStorageClient(basePath, serveBaseUrl);
  }

  return new NotConfiguredFileStorageClient();
}
