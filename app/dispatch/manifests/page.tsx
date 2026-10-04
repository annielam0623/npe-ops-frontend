import type { Metadata } from "next";

import { ManifestsPage } from "@/components/dispatch-manifest/manifests-page";

export const metadata: Metadata = {
  title: "Tour manifests",
};

export default function DispatchManifestsPage() {
  return <ManifestsPage />;
}
