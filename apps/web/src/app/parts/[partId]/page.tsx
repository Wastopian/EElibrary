/**
 * File header: Implements the engineer-first component detail workspace. The async server
 * component fetches the part record and delegates rendering to the pure PartDetailView
 * component, which is unit-tested separately.
 */

import { notFound } from "next/navigation";
import { buildPartDetailViewModel } from "@ee-library/shared";
import { fetchPartDetail } from "../../../lib/api-client";
import { PartDetailView } from "../../../components/PartDetailView";

/** dynamic forces detail data to flow through the API service at request time. */
export const dynamic = "force-dynamic";

/** DetailPageProps supports the Next.js app-router params shape. */
interface DetailPageProps {
  /** Route params from the app router. */
  params: Promise<{ partId: string }>;
}

/**
 * Renders the engineer-first part detail workspace.
 */
export default async function PartDetailPage({ params }: DetailPageProps) {
  const { partId } = await params;
  const record = await fetchPartDetail(partId);

  if (!record) {
    notFound();
  }

  const viewModel = buildPartDetailViewModel(record);
  return <PartDetailView viewModel={viewModel} />;
}
