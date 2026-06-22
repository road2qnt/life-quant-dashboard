import { getRecentEvents } from "@/app/actions/events";
import { getDomains } from "@/app/actions/domains";
import { StatCard } from "@/components/stat-card";
import { QuickLogForm } from "@/components/quick-log-form";
import { RecentEvents } from "@/components/recent-events";
import { QuickLogFab } from "@/components/quick-log-fab";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [domains, recentEvents, todaysEvents] = await Promise.all([
    getDomains(),
    getRecentEvents(5),
    getRecentEvents(100).then((events) =>
      events.filter((e) => new Date(e.timestamp).toDateString() === new Date().toDateString())
    ),
  ]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <StatCard label="Events Today" value={String(todaysEvents.length)} accent="var(--green)" />
        <StatCard label="Active Domains" value={String(domains.length)} accent="var(--blue)" />
        <StatCard label="Recent (5)" value={String(recentEvents.length)} accent="var(--purple)" />
        <StatCard label="Domains" value={String(domains.length)} accent="var(--teal)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Quick Log</h3>
          <QuickLogForm domains={domains} />
        </section>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Recent Events</h3>
          <RecentEvents events={recentEvents} />
        </section>
      </div>

      <QuickLogFab />
    </div>
  );
}
