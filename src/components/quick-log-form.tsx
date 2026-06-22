"use client";

import { useState } from "react";
import { logEvent } from "@/app/actions/events";

export function QuickLogForm({ domains }: { domains: { id: string; label: string; icon: string | null }[] }) {
  const [domainId, setDomainId] = useState(domains[0]?.id ?? "");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "ok">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!domainId || !value) return;
    setStatus("submitting");
    const res = await logEvent({ domainId, value: Number(value), note: note || undefined });
    setStatus(res.success ? "ok" : "error");
    if (res.success) {
      setValue("");
      setNote("");
      setTimeout(() => setStatus("idle"), 1500);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <select value={domainId} onChange={(e) => setDomainId(e.target.value)} disabled={status === "submitting"}>
        {domains.map((d) => (
          <option key={d.id} value={d.id}>{d.icon ?? ""} {d.label}</option>
        ))}
      </select>
      <input
        type="number"
        step="0.1"
        placeholder="Value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={status === "submitting"}
      />
      <input
        type="text"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={status === "submitting"}
      />
      <button type="submit" disabled={status === "submitting" || !domainId || !value}>
        {status === "submitting" ? "Logging..." : "Log Event"}
      </button>
      {status === "ok" && <span style={{ color: "var(--green)" }}>✓ Logged</span>}
      {status === "error" && <span style={{ color: "var(--red)" }}>✗ Failed</span>}
    </form>
  );
}
