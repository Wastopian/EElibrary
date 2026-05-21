/**
 * Minimal type surface for occt-import-js (OpenCascade compiled to WASM).
 *
 * The package ships no types. We only declare the slice the STEP viewer uses:
 * the module factory plus the `ReadStepFile` result shape, which is documented as
 * three.js-compatible (flat position/normal/index arrays).
 */

declare module "occt-import-js" {
  export interface OcctModuleOptions {
    /** Resolves the runtime path of the `.wasm` binary; overridden so the bundler-emitted URL is used. */
    locateFile?: (path: string, scriptDirectory: string) => string;
    /** Pre-fetched wasm bytes; when set, emscripten uses these instead of fetching. */
    wasmBinary?: ArrayBuffer | Uint8Array;
  }

  export interface OcctNumberArray {
    array: number[];
  }

  export interface OcctMeshAttributes {
    position: OcctNumberArray;
    normal?: OcctNumberArray;
  }

  export interface OcctMesh {
    name: string;
    color?: [number, number, number];
    attributes: OcctMeshAttributes;
    index: OcctNumberArray;
  }

  export interface OcctImportResult {
    success: boolean;
    meshes: OcctMesh[];
  }

  export interface OcctReadParams {
    linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
    linearDeflectionType?: "bounding_box_ratio" | "absolute_value";
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctReadParams | null): OcctImportResult;
    ReadBrepFile(content: Uint8Array, params: OcctReadParams | null): OcctImportResult;
    ReadIgesFile(content: Uint8Array, params: OcctReadParams | null): OcctImportResult;
  }

  export default function occtimportjs(options?: OcctModuleOptions): Promise<OcctModule>;
}
