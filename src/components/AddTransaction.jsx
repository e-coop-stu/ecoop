import React, { useState } from "react";
import { db } from "../lib/firebase";
import { addDoc, collection, Timestamp } from "firebase/firestore";

const METHODS = ["Face Pay", "RFID/卡片", "現金"];

export default function AddTransaction() {
  const [total, setTotal] = useState("");
  const [method, setMethod] = useState(METHODS[0]);
  const [when, setWhen] = useState(() => {
    // 讓 <input type="datetime-local"> 用本地時間
    const t = new Date();
    const iso = new Date(t.getTime() - t.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    return iso;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const tsDate = new Date(when);
      await addDoc(collection(db, "transactions"), {
        ts: Timestamp.fromDate(tsDate),
        total: Number(total),
        method,
      });
      setMsg("✅ 已新增！");
      setTotal("");
      // 通知 Dashboard 重新抓資料（你不想重構的情況下最簡單）
      window.dispatchEvent(new Event("tx-added"));
    } catch (err) {
      setMsg("新增失敗：" + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1.4fr auto",
        gap: 8,
        alignItems: "end",
        margin: "12px 0",
      }}
    >
      <label style={{ display: "grid", gap: 4 }}>
        金額
        <input
          type="number"
          min="0"
          step="1"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          required
        />
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        付款方式
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "grid", gap: 4 }}>
        時間
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          required
        />
      </label>

      <button type="submit" disabled={busy || !total}>
        {busy ? "處理中…" : "新增"}
      </button>

      {msg && <div style={{ gridColumn: "1 / -1", color: "#0ea567" }}>{msg}</div>}
    </form>
  );
}
