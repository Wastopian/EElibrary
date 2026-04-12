/**
 * File header: Provides a global loading state for route transitions.
 */

import { EmptyState } from "@ee-library/ui";

/**
 * Renders a concise loading state for the app router.
 */
export default function Loading() {
  return <EmptyState body="Preparing normalized component records." title="Loading workspace" />;
}
