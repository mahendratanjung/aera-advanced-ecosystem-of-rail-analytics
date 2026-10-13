import { Suspense } from "react";
import { Insights } from "@/features/insights/Insights";

export const metadata = { title: "Busy times" };

export default function Page() {
  return <Suspense><Insights /></Suspense>;
}
