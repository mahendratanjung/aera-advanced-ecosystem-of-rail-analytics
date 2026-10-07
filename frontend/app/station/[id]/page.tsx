import { redirect } from "next/navigation";

/** Old station links open the map with that station's card (docs/AERA_UX_V2.md). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?station=${encodeURIComponent(id)}`);
}
