// BarcodeScanner.jsx placeholder
import React, { useEffect } from "react";

export default function BarcodeScanner({ onDetected }) {
  useEffect(() => {
    console.log("🔍 Barcode scanner 初始化 (demo)");
    // 這裡以後可以接 QuaggaJS 或其他套件
  }, []);

  return (
    <div style={{ padding: 20, background: "#f1f5f9", borderRadius: 8 }}>
      <p>📷 Barcode Scanner (Demo 占位元件)</p>
      <button
        className="btn"
        onClick={() => onDetected && onDetected("1234567890")}
      >
        模擬掃描條碼
      </button>
    </div>
  );
}
