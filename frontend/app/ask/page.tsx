import { Suspense } from "react";
import { AskPage } from "@/features/assistant/AskPage";

export const metadata = { title: "Ask AERA" };

export default function Page() {
  return <Suspense><AskPage /></Suspense>;
}
