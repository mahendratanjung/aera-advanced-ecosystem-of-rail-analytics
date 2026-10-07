import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { BottomNav } from "@/components/BottomNav";
import { ConnectionBanner } from "@/components/States";
import { TopBar } from "@/components/TopBar";
import { BRAND } from "@/lib/brand";
import { RealtimeProvider } from "@/lib/realtime";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta" });

export const metadata: Metadata = {
  title: { default: `${BRAND.name} · How full is the next train?`, template: `%s · ${BRAND.name}` },
  description: BRAND.tagline,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body>
        <RealtimeProvider>
          <TopBar />
          <ConnectionBanner />
          <div className="pb-[76px] lg:pb-0">{children}</div>
          <BottomNav />
        </RealtimeProvider>
      </body>
    </html>
  );
}
