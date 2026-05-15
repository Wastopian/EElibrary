/**
 * File header: Tiny progressive-enhancement hook that auto-submits the parent <form> whenever a
 * <select> within it changes value.
 *
 * The catalog filter rail is otherwise a plain server-rendered <form method="get">. Engineers
 * complained that every facet tweak required a separate "Apply filters" click; this component
 * keeps the form working without JS (the submit button is still visible) but eliminates the
 * extra click for the common interactive case. Mount once anywhere inside the form.
 */

"use client";

import React, { useEffect, useRef } from "react";

export function AutoSubmitOnChange(): React.ReactElement {
  const anchorRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const form = anchor.closest("form");
    if (!form) return;

    function onChange(event: Event) {
      const target = event.target as HTMLElement | null;
      if (target && target.tagName === "SELECT") {
        if (typeof form!.requestSubmit === "function") {
          form!.requestSubmit();
        } else {
          form!.submit();
        }
      }
    }

    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);

  return <span ref={anchorRef} aria-hidden="true" style={{ display: "none" }} />;
}
