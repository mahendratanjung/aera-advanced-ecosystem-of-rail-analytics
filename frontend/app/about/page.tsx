import { Page, Section } from "@/components/Page";
import { CrowdScale } from "@/components/Crowd";
import { BRAND } from "@/lib/brand";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <Page title={`About ${BRAND.name}`} intro={<>{BRAND.longName}. A digital twin of the LRT Kelana Jaya Line that predicts how full each train is, so you can choose when to travel and which train to board.</>}>
      <Section title="What you see">
        <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-ink-2">
          <li>Every train on the line, moving to the published timetable on a shared clock.</li>
          <li>How full each train is predicted to be, from Quiet to Packed, and car by car.</li>
          <li>The next trains at any station, the calmest train for a ride, and when the line is busiest through the week.</li>
          <li>The effect of delays and events: a held train leaves the next one fuller, and an event crowd fills trains downstream.</li>
          <li>Other ways to travel when trains stop: wait, go round on other Rapid Rail lines, or bridge the gap by bus or e-hailing.</li>
          <li>Ask AERA, a chat assistant that answers from the same timetable and predictions.</li>
        </ul>
      </Section>
      <Section title="How full trains are">
        <div className="card max-w-md p-5"><CrowdScale /></div>
        <p className="mt-3 text-sm text-ink-2">Percentages are of the 800-person capacity of a four-car train, seated and standing.</p>
      </Section>
      <Section title="What is real and what is predicted">
        <p className="text-[15px] leading-relaxed text-ink-2">
          Train positions follow the timetable, not live tracking: no live train feed is published for Rapid Rail. Crowding is a prediction
          built from recent gate taps, not a live count. AERA is a decision aid and does not control or replace station operations.
        </p>
      </Section>
      <Section title="Data sources">
        <ul className="list-disc space-y-1 pl-5 text-[15px] text-ink-2">
          <li>Timetable, stops and track: Prasarana Rapid Rail KL GTFS Static, via data.gov.my.</li>
          <li>Journeys: Daily Origin-Destination Ridership, Rapid Rail (KV), data.gov.my.</li>
          <li>Shape of the day: Hourly Origin-Destination Ridership, KTM Komuter, data.gov.my.</li>
          <li>Other Rapid Rail lines, for other ways to travel: the same GTFS Static feed. Walking times between lines are estimates.</li>
          <li>Basemap: © Mapbox, © OpenStreetMap contributors (Mapbox Standard); without a Mapbox key, © CARTO.</li>
          <li>3D train: an Innovia Metro 300 model built for AERA from photographs of the line&apos;s trains.</li>
          <li>Station photos: Wikimedia Commons, with each author and licence shown on the station card.</li>
          <li>Ask AERA: a free AI model reached through OpenRouter, when the service has a key.</li>
        </ul>
      </Section>
      <Section title="Privacy">
        <p className="text-[15px] text-ink-2">All ridership data is published in aggregate. AERA collects nothing about passengers.
          Questions typed into Ask AERA are sent to OpenRouter and the model provider to be answered, so do not include personal details.
          &quot;Near me&quot; uses your location once, in your browser only.</p>
      </Section>
      <Section title="Team">
        <p className="text-[15px] text-ink-2">
          Group 2, Technopreneurship Team Project, Universiti Teknologi PETRONAS, September 2026 semester: Mahendra (CEO), Wina (CTO),
          Khal (CFO), Zidane (CMO). Supervised by Dr Farahida Hanim Binti Mausor.
        </p>
      </Section>
    </Page>
  );
}
