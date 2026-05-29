"use client";

// Inline stage-transition buttons used per-application on the
// employer dashboard. PATCH /api/dashboard/applications/[id] with
// the new stage; refresh the row's local state on success.
// Triggers a router.refresh() so the server-rendered counts at the
// top of the page update.

import { useState } from "react";
import { useRouter } from "next/navigation";

const STAGES = [
  { key: "applied", label: "Applied" },
  { key: "shortlisted", label: "Shortlist" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Reject" },
] as const;

export function StageButtons({
  applicationId,
  currentStage,
}: {
  applicationId: string;
  currentStage: string;
}) {
  const [stage, setStage] = useState(currentStage);
  const [saving, setSaving] = useState<string | null>(null);
  const router = useRouter();

  async function setTo(next: string) {
    if (next === stage) return;
    setSaving(next);
    try {
      const res = await fetch(`/api/dashboard/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      if (res.ok) {
        setStage(next);
        router.refresh();
      }
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap" }}>
      {STAGES.map((s) => {
        const active = s.key === stage;
        const isLoading = saving === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => setTo(s.key)}
            disabled={!!saving}
            style={{
              fontSize: 10,
              padding: "3px 8px",
              background: active ? "#111" : "transparent",
              color: active ? "#fff" : "#666",
              border: "0.5px solid #e8e0c8",
              cursor: saving ? "wait" : "pointer",
              textTransform: "uppercase",
              letterSpacing: ".05em",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
