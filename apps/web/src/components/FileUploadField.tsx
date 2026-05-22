"use client";

/**
 * File header: Clean file picker for forms - hides the native "Browse" control behind a
 * styled button and shows the chosen filename so the selection stays visible before submit.
 */

import React, { useState } from "react";

interface FileUploadFieldProps {
  accept?: string;
  ariaLabel?: string;
  buttonLabel?: string;
  caption: string;
  className?: string;
  name?: string;
  onFileChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}

/**
 * Renders a field-shaped label with a caption, a styled trigger button, and the selected
 * filename. The native input is visually hidden but still participates in form submission and
 * opens via the wrapping label, so it works in both client forms and server-action forms.
 */
export function FileUploadField({
  accept,
  ariaLabel,
  buttonLabel = "Choose file",
  caption,
  className,
  name,
  onFileChange,
  required
}: FileUploadFieldProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <label className={`file-field${className ? ` ${className}` : ""}`}>
      <span className="file-field__caption">{caption}</span>
      <input
        accept={accept}
        aria-label={ariaLabel ?? caption}
        className="file-upload__input"
        name={name}
        onChange={(event) => {
          setFileName(event.target.files?.[0]?.name ?? null);
          onFileChange?.(event);
        }}
        required={required}
        type="file"
      />
      <span className="button-link button-link--quiet file-field__button">{buttonLabel}</span>
      <span className="file-field__filename">{fileName ?? "No file chosen"}</span>
    </label>
  );
}
