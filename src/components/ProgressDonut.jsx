import React from "react";

export default function ProgressDonut({ percent = 41, label = "Project Ended" }) {
  const size = 180;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;

  return (
    <div className="card" style={{ display: "grid", placeItems: "center", position: "relative" }}>
      <div className="ring">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#0ea567"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="label" style={{ position: "absolute", fontWeight: 800, fontSize: 32 }}>
          {percent}%
        </div>
      </div>
      <div style={{ marginTop: -8, color: "#64748b" }}>{label}</div>
      <div className="row" style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>
        <span style={{ width: 10, height: 10, background: "#0ea567", borderRadius: 3 }} /> Completed
        <span style={{ width: 10, height: 10, background: "#22c55e", borderRadius: 3 }} /> In Progress
        <span style={{ width: 10, height: 10, background: "#94a3b8", borderRadius: 3 }} /> Pending
      </div>
    </div>
  );
}
