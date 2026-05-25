/**
 * Tiny client-only mount for a glTF/glb preview artifact.
 *
 * Uses Google's <model-viewer> web component, lazy-loaded only when this component
 * actually renders, so the ~600KB module never enters the SSR bundle and never costs
 * anything for engineers viewing PDFs, images, or non-3D parts.
 *
 * Honesty rules:
 *  - Renders nothing decorative until the script has loaded; an explicit "Loading 3D
 *    preview" caption stays visible so a stalled load is never silently masked.
 *  - On script-load failure, falls back to an explicit error caption + the artifact
 *    download link so the engineer can still inspect the bytes.
 *  - The download link below the viewer always points at the same artifact storage
 *    key the viewer is bound to, so what you see is what you can save.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          ar?: boolean;
          "auto-rotate"?: boolean;
          "camera-controls"?: boolean;
          "shadow-intensity"?: string;
          loading?: "auto" | "lazy" | "eager";
          reveal?: "auto" | "interaction" | "manual";
        },
        HTMLElement
      >;
    }
  }
}

type ThreeDInlinePreviewProps = {
  artifactUrl: string;
  altText: string;
};

type LoadState = "loading" | "ready" | "failed";

let modelViewerLoadPromise: Promise<void> | null = null;

/**
 * Lazy-loads the @google/model-viewer module exactly once per page lifetime.
 *
 * Memoized so multiple viewer mounts on the same page (e.g. /compare) share one
 * download. The dynamic import below is statically analyzable and lets the bundler
 * code-split the viewer into its own chunk.
 */
function loadModelViewerModule(): Promise<void> {
  if (modelViewerLoadPromise) {
    return modelViewerLoadPromise;
  }

  modelViewerLoadPromise = import("@google/model-viewer")
    .then(() => undefined)
    .catch((error: unknown) => {
      modelViewerLoadPromise = null;
      throw error;
    });

  return modelViewerLoadPromise;
}

export function ThreeDInlinePreview({ artifactUrl, altText }: ThreeDInlinePreviewProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    loadModelViewerModule()
      .then(() => {
        if (!cancelledRef.current) {
          setLoadState("ready");
        }
      })
      .catch(() => {
        if (!cancelledRef.current) {
          setLoadState("failed");
        }
      });

    return () => {
      cancelledRef.current = true;
    };
  }, []);

  if (loadState === "failed") {
    return (
      <div className="asset-inline-preview asset-inline-preview--note" role="note">
        <p className="muted-copy">
          The 3D viewer module could not load. Use <strong>Download preview artifact</strong> below to fetch the rendered glTF/glb file directly.
        </p>
        <p className="asset-inline-preview__fallback muted-copy">
          <a href={artifactUrl} download>
            Download preview artifact
          </a>
        </p>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div className="asset-inline-preview asset-inline-preview--note" role="status">
        <p className="muted-copy">Loading 3D preview…</p>
      </div>
    );
  }

  return (
    <div className="asset-inline-preview">
      <p className="asset-inline-preview__caption">Inline preview (derived 3D model)</p>
      <model-viewer
        alt={altText}
        auto-rotate
        camera-controls
        className="asset-inline-preview__three-d"
        loading="lazy"
        reveal="auto"
        shadow-intensity="0.4"
        src={artifactUrl}
      />
      <p className="asset-inline-preview__fallback muted-copy">
        This is a derived viewer-only model. The original STEP file is unchanged and unaffected by this preview.
        {" "}
        <a href={artifactUrl} download>
          Download preview artifact
        </a>
      </p>
    </div>
  );
}
