"use client";

/**
 * File header: Copy-to-clipboard button for the team invite code. The only client JS on the Team page;
 * everything else (loading the code, generating, regenerating) is server-rendered.
 */

import React from "react";

/** CopyInviteCodeProps carries the code to place on the clipboard. */
interface CopyInviteCodeProps {
  inviteCode: string;
}

/**
 * Renders a button that copies the invite code and briefly confirms it, degrading to a no-op label when
 * the Clipboard API is unavailable (older or locked-down browsers).
 */
export function CopyInviteCode({ inviteCode }: CopyInviteCodeProps) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the code is visible on screen for manual copy either way.
      setCopied(false);
    }
  }

  return (
    <button aria-label="Copy the team invite code" className="button-link" onClick={handleCopy} type="button">
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
