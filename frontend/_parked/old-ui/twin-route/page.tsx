import { ClockChip } from "@/components/ClockChip";
import { NetworkPanel } from "@/features/network-twin/NetworkPanel";

/** PAX-01, UX-01: the first view is the live network twin. No landing page. */
export default function NetworkPage() {
  return (
    <>
      <h1 className="sr-only">AERA network twin of the Kelana Jaya Line</h1>
      <ClockChip className="fixed left-3 top-14 z-20 md:bottom-4 md:left-[88px] md:top-auto" />
      <NetworkPanel />
    </>
  );
}
