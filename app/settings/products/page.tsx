import type { Metadata } from "next";

import { ProductsView } from "@/components/products/products-view";

export const metadata: Metadata = {
  title: "Products",
};

// 数据只在客户端组件里请求：session cookie 只有浏览器发起的同源请求才会带上。
export default function ProductsPage() {
  return <ProductsView />;
}
