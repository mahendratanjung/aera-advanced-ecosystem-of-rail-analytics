import { Suspense } from "react";
import { TripPlanner } from "@/features/trip/TripPlanner";

export const metadata = { title: "Plan a ride" };

export default function Page() {
  return <Suspense><TripPlanner /></Suspense>;
}
