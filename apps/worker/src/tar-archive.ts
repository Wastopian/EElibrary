/**
 * File header: Re-exports the shared tar/gzip writer.
 *
 * The implementation moved to `@ee-library/shared/tar-archive` so the API can package archives
 * (inline KiCad library emission) without crossing the web/api/worker boundary. This shim keeps the
 * existing worker imports (`./tar-archive`) working unchanged.
 */

export * from "@ee-library/shared/tar-archive";
