import { NetworkView } from "@/features/network/NetworkView";

export const metadata = { title: "Network map" };

/** The whole Klang Valley rail network, like the integrated transit poster (NETM-01). */
export default function NetworkPage() {
  return <NetworkView />;
}
