/**
 * File header: Translates setup-required error codes into plain-English headlines for end users.
 */

/** SetupStateCopy carries the user-facing headline and a short follow-up line. */
export type SetupStateCopy = {
  headline: string;
  body: string;
};

/**
 * Maps a known setup-state error code to plain-English copy for non-operator audiences.
 * The raw code and message stay available for technical-details disclosures.
 */
export function getSetupStateCopy(code: string): SetupStateCopy {
  if (code === "DB_NOT_CONFIGURED") {
    return {
      headline: "The catalog database is not connected yet.",
      body: "An administrator needs to bring it online. You can still browse this page while setup finishes."
    };
  }

  if (code === "API_UNAVAILABLE") {
    return {
      headline: "We cannot reach the catalog service right now.",
      body: "This usually clears on its own. Try again in a moment, or check the System page."
    };
  }

  if (code.startsWith("HTTP_5")) {
    return {
      headline: "The catalog service hit an error.",
      body: "It is not something you did. Try again, or check the System page if it persists."
    };
  }

  if (code.startsWith("HTTP_4")) {
    return {
      headline: "We could not load this view.",
      body: "Check that the link or address is right, or return to the catalog."
    };
  }

  return {
    headline: "Something is keeping this page from loading.",
    body: "Try again, or open the System page to see what is missing."
  };
}
