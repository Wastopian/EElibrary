/**
 * File header: Root route opens the project dashboard so engineers land on active work first.
 * Catalog search remains at /catalog with the same sidebar search form.
 */

import ProjectsPage from "./projects/page";

type RootPageProps = Parameters<typeof ProjectsPage>[0];

/**
 * Renders the projects dashboard at / so opening the site starts in project memory.
 */
export default async function RootPage(props: RootPageProps) {
  return ProjectsPage(props);
}
