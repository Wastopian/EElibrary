/**
 * Client-only in-browser viewer for STEP source files.
 *
 * STEP is not a browser-renderable format, so we parse it with OpenCascade compiled to
 * WASM (occt-import-js) and render the resulting mesh with three.js. This needs no
 * server-side converter and no derived glTF/glb artifact — it reads the stored STEP bytes
 * directly. The ~7MB WASM module and three.js are dynamically imported only when this
 * component mounts, so engineers viewing PDFs, images, or parts without a 3D model never
 * pay for them.
 *
 * Honesty rules (mirroring ThreeDInlinePreview):
 *  - An explicit "Loading 3D model" caption stays visible until geometry is on screen, so a
 *    stalled parse or WASM load is never silently masked.
 *  - On any failure (WASM load, fetch, parse, empty geometry) we render an explicit error
 *    caption plus the source-file download link, so the engineer can still inspect the bytes.
 *  - The model shown is a tessellated view derived from the STEP file; the original STEP is
 *    unchanged and its validation / approval / export state is untouched by this preview.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import type { OrbitControls as OrbitControlsType } from "three/addons/controls/OrbitControls.js";
import type { OcctModule } from "occt-import-js";

type StepInlinePreviewProps = {
  /** Same-origin URL that streams the raw STEP bytes. */
  sourceUrl: string;
  /** URL used for the explicit download fallback link. */
  downloadUrl: string;
  altText: string;
};

type LoadState = "loading" | "ready" | "failed";

const DEFAULT_MESH_COLOR = 0xb6bcc6;

/** occtModulePromise memoizes the WASM module across mounts (e.g. the /compare page). */
let occtModulePromise: Promise<OcctModule> | null = null;

/**
 * Lazy-loads and instantiates the OpenCascade WASM module exactly once per page lifetime.
 *
 * The `.wasm` URL is resolved through the bundler so it is emitted as a hashed static asset
 * and located at runtime via emscripten's `locateFile`.
 */
function loadOcctModule(): Promise<OcctModule> {
  if (occtModulePromise) {
    return occtModulePromise;
  }

  occtModulePromise = (async () => {
    const occtFactory = (await import("occt-import-js")).default;
    const wasmUrl = new URL("occt-import-js/dist/occt-import-js.wasm", import.meta.url);
    return occtFactory({ locateFile: () => wasmUrl.href });
  })().catch((error: unknown) => {
    occtModulePromise = null;
    throw error;
  });

  return occtModulePromise;
}

export function StepInlinePreview({ sourceUrl, downloadUrl, altText }: StepInlinePreviewProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) {
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControlsType | null = null;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;
    let scene: THREE.Scene | null = null;

    async function setup(target: HTMLDivElement): Promise<void> {
      const [three, orbitModule, occt, response] = await Promise.all([
        import("three"),
        import("three/addons/controls/OrbitControls.js"),
        loadOcctModule(),
        fetch(sourceUrl, { credentials: "same-origin" })
      ]);

      if (!response.ok) {
        throw new Error(`STEP fetch failed (${response.status})`);
      }

      const stepBytes = new Uint8Array(await response.arrayBuffer());
      const parsed = occt.ReadStepFile(stepBytes, null);
      if (!parsed.success || parsed.meshes.length === 0) {
        throw new Error("STEP file contained no renderable geometry");
      }

      if (cancelled) {
        return;
      }

      const width = Math.max(target.clientWidth, 1);
      const height = Math.max(target.clientHeight, 1);

      scene = new three.Scene();
      scene.background = new three.Color(0x1c1c20);

      const camera = new three.PerspectiveCamera(45, width / height, 0.1, 10_000);

      renderer = new three.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      target.appendChild(renderer.domElement);

      scene.add(new three.HemisphereLight(0xffffff, 0x303036, 1.1));
      const keyLight = new three.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(1, 1.5, 1);
      scene.add(keyLight);
      const fillLight = new three.DirectionalLight(0xffffff, 0.6);
      fillLight.position.set(-1, -0.5, -1);
      scene.add(fillLight);

      const group = new three.Group();
      for (const mesh of parsed.meshes) {
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("position", new three.Float32BufferAttribute(mesh.attributes.position.array, 3));
        if (mesh.attributes.normal) {
          geometry.setAttribute("normal", new three.Float32BufferAttribute(mesh.attributes.normal.array, 3));
        }
        geometry.setIndex(mesh.index.array);
        if (!mesh.attributes.normal) {
          geometry.computeVertexNormals();
        }

        const color = mesh.color
          ? new three.Color(mesh.color[0], mesh.color[1], mesh.color[2])
          : new three.Color(DEFAULT_MESH_COLOR);
        const material = new three.MeshStandardMaterial({
          color,
          metalness: 0.2,
          roughness: 0.6,
          side: three.DoubleSide
        });
        group.add(new three.Mesh(geometry, material));
      }
      scene.add(group);

      const box = new three.Box3().setFromObject(group);
      const size = box.getSize(new three.Vector3());
      const center = box.getCenter(new three.Vector3());
      group.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const fovRadians = camera.fov * (Math.PI / 180);
      const distance = (maxDim / 2 / Math.tan(fovRadians / 2)) * 1.8;
      camera.position.set(distance * 0.8, distance * 0.6, distance);
      camera.near = Math.max(distance / 1000, 0.01);
      camera.far = distance * 1000;
      camera.updateProjectionMatrix();

      controls = new orbitModule.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, 0, 0);
      controls.update();

      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        controls?.update();
        if (renderer && scene) {
          renderer.render(scene, camera);
        }
      };
      renderLoop();

      resizeObserver = new ResizeObserver(() => {
        const nextWidth = Math.max(target.clientWidth, 1);
        const nextHeight = Math.max(target.clientHeight, 1);
        camera.aspect = nextWidth / nextHeight;
        camera.updateProjectionMatrix();
        renderer?.setSize(nextWidth, nextHeight);
      });
      resizeObserver.observe(target);

      if (!cancelled) {
        setLoadState("ready");
      }
    }

    setup(mount).catch(() => {
      if (!cancelled) {
        setLoadState("failed");
      }
    });

    return () => {
      cancelled = true;
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      controls?.dispose();
      if (scene) {
        scene.traverse((object) => {
          const asMesh = object as Partial<THREE.Mesh>;
          asMesh.geometry?.dispose();
          const material = asMesh.material;
          if (Array.isArray(material)) {
            for (const entry of material) {
              entry.dispose();
            }
          } else {
            material?.dispose();
          }
        });
      }
      if (renderer) {
        renderer.dispose();
        renderer.domElement.remove();
      }
    };
  }, [sourceUrl]);

  return (
    <div className="asset-inline-preview">
      <p className="asset-inline-preview__caption">Inline preview (3D model from STEP)</p>
      <div className="step-inline-preview__stage">
        <div aria-label={altText} className="step-inline-preview__canvas" ref={mountRef} role="img" />
        {loadState !== "ready" ? (
          <div className="step-inline-preview__overlay" role={loadState === "failed" ? "note" : "status"}>
            {loadState === "loading" ? (
              <p className="muted-copy">Loading 3D model…</p>
            ) : (
              <p className="muted-copy">
                This 3D model could not be displayed in the browser. Use <strong>Download STEP</strong> below to open it in your CAD tool.
              </p>
            )}
          </div>
        ) : null}
      </div>
      <p className="asset-inline-preview__fallback muted-copy">
        {loadState === "ready" ? "Drag to rotate, scroll to zoom. " : null}
        This is a view generated from the STEP file; the original file is unchanged.
        {" "}
        <a href={downloadUrl} download>
          Download STEP
        </a>
      </p>
    </div>
  );
}
