import React from "react";

export default function StatCard({ title, value, note, right, gradient = false }) {
  return (
    <div
      className="card"
      style={
        gradient
          ? {
              background: "linear-gradient(135deg, #0ea567, #074f3b)",
              color: "#fff",
              border: "none",
            }
          : {}
      }
    >
      <div className="card-head">
        <div style={{ opacity: gradient ? 0.9 : 0.8 }}>{title}</div>
        {right}
      </div>
      <div className="kpi">{value}</div>
      {note && <div style={{ opacity: 0.8, marginTop: 6, fontSize: 12 }}>{note}</div>}
    </div>
  );
}
