"use client";

/**
 * File header: Global keyboard shortcut to focus the workspace part search from anywhere.
 *
 * Uses the conventional, safe bindings - "/" (ignored while typing in a field, so it never
 * eats real input) and Ctrl/Cmd+K (works even from another field). Enter is intentionally not
 * used: it would hijack form submits and button activation across the app. Renders nothing.
 */

import { useEffect } from "react";

/** SEARCH_INPUT_ID matches the id on the sidebar/top-bar part search input. */
const SEARCH_INPUT_ID = "sidebar-search";

/**
 * Returns true when the event originated in a text-entry element, so "/" typed into a field
 * is left alone.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) {
    return false;
  }

  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

/**
 * Attaches the focus-search hotkey for the lifetime of the app shell.
 */
export function SearchHotkey(): null {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const isSlash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isCmdK = (event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K");

      if (!isSlash && !isCmdK) {
        return;
      }

      // "/" should still type normally when the user is already in a field; Ctrl/Cmd+K may jump
      // from anywhere, including another input.
      if (isSlash && isTypingTarget(event.target)) {
        return;
      }

      const input = document.getElementById(SEARCH_INPUT_ID);
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      event.preventDefault();
      input.focus();
      input.select();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
