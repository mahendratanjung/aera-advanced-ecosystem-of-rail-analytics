import { AppNav } from "@/components/AppNav";
import { NetworkMap } from "@/features/network-twin/NetworkMap";

/** The map lives here so it stays mounted between the line and a station (UX-04). */
export default function TwinLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NetworkMap />
      <AppNav />
      {children}
    </>
  );
}
