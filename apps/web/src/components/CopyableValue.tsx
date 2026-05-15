/**
 * File header: Tiny client component that renders a monospace value with a copy-to-clipboard
 * affordance.
 *
 * Engineers paste MPNs, archive hashes, signer fingerprints, storage keys, and part ids into
 * other tools constantly. Forcing a manual triple-click + Cmd+C on every value is the kind of
 * friction this surface is meant to remove. Falls back to `document.execCommand("copy")` on
 * browsers that block `navigator.clipboard` over non-HTTPS or in restricted contexts.
 */

"use client";

import React, { useCallback, useState } from "react";

export interface CopyableValueProps {
  /** Visible label inside the mono span (e.g. the MPN). */
  children: React.ReactNode;
  /** Plain string actually written to the clipboard; falls back to children when it is a string. */
  copyValue?: string;
  /** Optional accessible name override (e.g. "Copy MPN", "Copy archive SHA-256"). */
  label?: string;
  /** Extra class on the wrapping mono span so callers can keep their existing styles. */
  className?: string;
}

const COPIED_FEEDBACK_MS = 1200;

async function writeToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the execCommand fallback path.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

export function CopyableValue({ children, copyValue, label, className }: CopyableValueProps): React.ReactElement {
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");

  const resolved = copyValue ?? (typeof children === "string" ? children : "");
  const accessibleLabel = label ?? (resolved ? `Copy ${resolved}` : "Copy value");

  const onClick = useCallback(async () => {
    if (!resolved) return;
    const ok = await writeToClipboard(resolved);
    setFeedback(ok ? "copied" : "failed");
    window.setTimeout(() => setFeedback("idle"), COPIED_FEEDBACK_MS);
  }, [resolved]);

  return (
    <span className={`copyable-value${className ? ` ${className}` : ""}`}>
      <span className="ui-mono copyable-value__text">{children}</span>
      <button
        aria-label={accessibleLabel}
        className="copyable-value__button"
        onClick={onClick}
        title={feedback === "copied" ? "Copied" : feedback === "failed" ? "Copy blocked" : accessibleLabel}
        type="button"
      >
        {feedback === "copied" ? "✓" : feedback === "failed" ? "!" : "⧉"}
      </button>
    </span>
  );
}
