/**
 * File header: Root route that opens the practical catalog workbench instead of a
 * separate landing page, keeping the first screen focused on search and import.
 */

import SearchPage from "./catalog/page";

type RootPageProps = Parameters<typeof SearchPage>[0];

/**
 * Renders the same workbench used by /catalog so opening the site starts the core loop.
 */
export default async function RootPage(props: RootPageProps) {
  return SearchPage(props);
}
