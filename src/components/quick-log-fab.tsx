"use client";

import { useState } from "react";
import { getDomains } from "@/app/actions/domains";
import { QuickLogForm } from "./quick-log-form";

export function QuickLogFab() {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<Awaited<ReturnType<typeof getDomains>>>([]);

  async function onOpen() {
    if (domains.length === 0) setDomains(await getDomains());
    setOpen(true);
  }

  if (!open) {
    return (
      <button
        onClick={onOpen}
        aria-label="Quick log"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--blue)",
          color: "white",
          fontSize: 28,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        }}
      >
        +
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
        width: 280,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <strong>Quick Log</strong>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer" }}>
          ✕
        </button>
      </div>
      <QuickLogForm domains={domains} />
    </div>
  );
}
