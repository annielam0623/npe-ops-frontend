import type { Metadata } from "next";

import { ManifestView } from "@/components/dispatch-manifest/manifest-view";

export const metadata: Metadata = {
  title: "Tour manifest",
};

// 日期和团从 ?date=&tour= 读（在浏览器里）。
export default function DispatchManifestPage() {
  return <ManifestView />;
}
