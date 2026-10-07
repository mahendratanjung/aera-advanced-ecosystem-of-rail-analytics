import { StationView } from "@/features/station-twin/StationView";

export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StationView id={id} />;
}
