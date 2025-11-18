// Card.jsx placeholder
// src/components/Card.jsx
import React from "react";

export default function Card({ title, right, children, style, className }) {
  return (
    <div className={`card ${className || ""}`} style={style}>
      {(title || right) && (
        <div className="card-head">
          <div>{title}</div>
          <div>{right}</div>
        </div>
      )}
      {/* 這一層一定要存在，並且能把高度撐滿 */}
      <div className="card-body">{children}</div>
    </div>
  );
}
