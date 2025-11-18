// Topbar.jsx placeholder
import React from "react";

export default function Topbar({ title, right }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "20px",
      }}
    >
      <h2 style={{ margin: 0 }}>{title}</h2>
      <div>{right}</div>
    </div>
  );
}

