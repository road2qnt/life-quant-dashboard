"use client";

import { useRouter } from "next/navigation";
import { deleteEvent } from "@/app/actions/events";

type RecentEvent = {
  id: string;
  domainId: string;
  domainLabel: string;
  domainIcon: string | null;
  value: number;
  note: string | null;
  timestamp: string;
};

export function RecentEvents({ events }: { events: RecentEvent[] }) {
  const router = useRouter();

  async function onDelete(id: string) {
    await deleteEvent(id);
    router.refresh();
  }

  if (events.length === 0) {
    return <p style={{ color: "var(--text-muted)" }}>No events yet.</p>;
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {events.map((e) => (
        <li
          key={e.id}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "8px 0",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span>
            {e.domainIcon ?? ""} {e.domainLabel}: <strong>{e.value}</strong>
            {e.note && <em style={{ color: "var(--text-muted)" }}> — {e.note}</em>}
          </span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <small style={{ color: "var(--text-muted)" }}>{new Date(e.timestamp).toLocaleString()}</small>
            <button onClick={() => onDelete(e.id)} style={{ color: "var(--red)", cursor: "pointer" }}>
              ✕
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}
