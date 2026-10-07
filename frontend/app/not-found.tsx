import Link from "next/link";
import { Page } from "@/components/Page";

export default function NotFound() {
  return (
    <Page title="This page is not on the line">
      <p className="text-ink-2"><Link href="/" className="font-medium text-accent">Go to the live line</Link> or pick a station from there.</p>
    </Page>
  );
}
