/**
 * File header: Root route that opens the practical catalog workbench instead of a
 * separate landing page, keeping the first screen focused on search and import.
 */

import SearchPage from "./catalog/page";

type RootPageProps = Parameters<typeof SearchPage>[0];

// Route segment config is not inherited from the imported catalog page module, so the root
// route declares its own: the workbench renders live API data and is never prerendered.
export const dynamic = "force-dynamic";

/**
 * Renders the same workbench used by /catalog so opening the site starts the core loop.
 */
export default async function RootPage(props: RootPageProps) {
  return SearchPage(props);
}
