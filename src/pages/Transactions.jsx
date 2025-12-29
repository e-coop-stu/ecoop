// src/pages/Transactions.jsx
import React, { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  limit,
} from "firebase/firestore";

// ===== 日期工具 =====
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const toLocalISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function toDateMaybeTs(v) {
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function fmtDateTime(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function Transactions() {
  // ✅ 預設 7 天
  const [from, setFrom] = useState(toLocalISODate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(toLocalISODate(new Date()));
  const [methodFilter, setMethodFilter] = useState("全部");
  const [busy, setBusy] = useState(false);

  const [rows, setRows] = useState([]); // 合併後的交易資料

  // ===== 讀 transactions（你原本的）=====
  async function fetchTransactions(fromTs, toTs) {
    const q1 = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "desc"),
      limit(5000)
    );
    const snap = await getDocs(q1);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ===== 讀 checkout_requests verified（樹莓派完成的）=====
  async function fetchCheckoutRequestsVerified(fromTs, toTs) {
    // createdAt 要能做 range + orderBy，需要 composite index（status + createdAt）
    const q1 = query(
      collection(db, "checkout_requests"),
      where("status", "==", "verified"),
      where("createdAt", ">=", fromTs),
      where("createdAt", "<=", toTs),
      orderBy("createdAt", "desc"),
      limit(5000)
    );
    const snap = await getDocs(q1);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ===== 正規化（讓兩種資料長得一樣）=====
  function normalizeTransaction(doc) {
    const ts = toDateMaybeTs(doc.ts);
    return {
      id: doc.id,
      ts,
      method: doc.method || doc.payMethod || doc.authMethod || "其他",
      total: Number(doc.total || 0),
      source: "transactions",
      raw: doc,
    };
  }

  function normalizeCheckoutRequest(doc) {
    const ts =
      toDateMaybeTs(doc.createdAt) ||
      toDateMaybeTs(doc.verifiedAt) ||
      toDateMaybeTs(doc.updatedAt) ||
      null;

    return {
      id: doc.id,
      ts,
      method: doc.method || "其他",
      total: Number(doc.total || 0),
      source: "checkout_requests",
      raw: doc,
    };
  }

  const load = async () => {
    setBusy(true);
    try {
      const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
      const toTs = Timestamp.fromDate(endOfDay(new Date(to)));

      const [txs, reqs] = await Promise.all([
        fetchTransactions(fromTs, toTs),
        fetchCheckoutRequestsVerified(fromTs, toTs),
      ]);

      const merged = [
        ...txs.map(normalizeTransaction),
        ...reqs.map(normalizeCheckoutRequest),
      ]
        .filter((r) => r.ts) // 沒時間的不要
        .sort((a, b) => b.ts - a.ts);

      setRows(merged);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 篩選後顯示 =====
  const filtered = useMemo(() => {
    if (methodFilter === "全部") return rows;
    return rows.filter((r) => (r.method || "其他") === methodFilter);
  }, [rows, methodFilter]);

  const methodOptions = useMemo(() => {
    const set = new Set(rows.map((r) => r.method || "其他"));
    return ["全部", ...Array.from(set)];
  }, [rows]);

  const totalSum = useMemo(
    () => filtered.reduce((acc, r) => acc + (Number(r.total) || 0), 0),
    [filtered]
  );

  // ===== 匯出 CSV =====
  const exportCSV = () => {
    const lines = [
      "時間,付款方式,金額,ID,來源",
      ...filtered.map((r) => {
        const t = r.ts ? fmtDateTime(r.ts) : "";
        return `${t},${r.method},${r.total},${r.id},${r.source}`;
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Topbar title="交易紀錄" />

      <Card title="篩選" className="span-12" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            自：
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>

          <label>
            至：
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>

          <label>
            付款方式：
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}>
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <button onClick={load} disabled={busy}>
            {busy ? "查詢中…" : "查詢"}
          </button>

          <button onClick={exportCSV} disabled={busy || filtered.length === 0}>
            匯出 CSV
          </button>

          <div style={{ marginLeft: "auto", fontWeight: 700 }}>
            總金額：{money(totalSum)}
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
          已合併：transactions + checkout_requests(verified)
        </div>
      </Card>

      <Card title="清單" className="span-12 card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left" style={{ padding: "10px 8px", color: "#64748b" }}>
                  時間
                </th>
                <th align="left" style={{ padding: "10px 8px", color: "#64748b" }}>
                  付款方式
                </th>
                <th align="right" style={{ padding: "10px 8px", color: "#64748b" }}>
                  金額
                </th>
                <th align="left" style={{ padding: "10px 8px", color: "#64748b" }}>
                  ID
                </th>
                <th align="left" style={{ padding: "10px 8px", color: "#64748b" }}>
                  來源
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.source}-${r.id}`}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    {r.ts ? fmtDateTime(r.ts) : "-"}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    {r.method}
                  </td>
                  <td
                    align="right"
                    style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}
                  >
                    {money(r.total)}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    {r.id}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #f1f5f9" }}>
                    {r.source}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, color: "#64748b" }}>
                    此期間沒有資料（或被篩選條件排除）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
