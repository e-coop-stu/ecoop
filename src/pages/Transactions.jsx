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
const startOfDay = (d) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const toLocalISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

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

/** 讀 hash query： "#/tx?q=xxx" -> "xxx" */
function readQFromHash() {
  const h = window.location.hash || "#/tx";
  const idx = h.indexOf("?");
  if (idx < 0) return "";
  const qs = h.slice(idx + 1);
  const p = new URLSearchParams(qs);
  return (p.get("q") || "").trim();
}

/** 清掉 #/tx?q=... */
function clearQInHash() {
  // 只留下 "#/tx"
  window.location.hash = "#/tx";
}

const s = (v) => (v == null ? "" : String(v).toLowerCase());

export default function Transactions() {
  // ✅ 預設 7 天
  const [from, setFrom] = useState(
    toLocalISODate(new Date(Date.now() - 6 * 86400000))
  );
  const [to, setTo] = useState(toLocalISODate(new Date()));
  const [methodFilter, setMethodFilter] = useState("全部");
  const [busy, setBusy] = useState(false);

  const [rows, setRows] = useState([]); // 合併後的交易資料
  const [q, setQ] = useState(readQFromHash()); // ✅ 來自 #/tx?q=

  // ✅ 監聽 hash 變更（App 搜尋會改 hash）
  useEffect(() => {
    const onHash = () => setQ(readQFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ===== 讀 transactions =====
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

  // ===== 讀 checkout_requests verified =====
  async function fetchCheckoutRequestsVerified(fromTs, toTs) {
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
        .filter((r) => r.ts)
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

  /** ✅ q 搜尋：比對 id / pickupCode / orderId / who / method / source / items */
  const matchesQ = (r, keyword) => {
    const k = s(keyword);
    if (!k) return true;

    const raw = r.raw || {};
    const items = Array.isArray(raw.items) ? raw.items : [];

    const hay = [
      r.id,
      r.source,
      r.method,
      r.total,
      raw.pickupCode,
      raw.orderId,
      raw.who,
      raw.studentId,
      raw.userId,
      raw.status,
      ...items.flatMap((it) => [
        it.name,
        it.sku,
        it.productId,
        it.productID,
        it.pid,
        it.barcode,
      ]),
    ]
      .map(s)
      .filter(Boolean)
      .join(" | ");

    return hay.includes(k);
  };

  // ===== 篩選後顯示（method + q）=====
  const filtered = useMemo(() => {
    let out = rows;

    if (methodFilter !== "全部") {
      out = out.filter((r) => (r.method || "其他") === methodFilter);
    }

    if (q) {
      out = out.filter((r) => matchesQ(r, q));
    }

    return out;
  }, [rows, methodFilter, q]);

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
      "時間,付款方式,金額,取貨碼,ID,來源,who,orderId",
      ...filtered.map((r) => {
        const t = r.ts ? fmtDateTime(r.ts) : "";
        const raw = r.raw || {};
        const pickup = raw.pickupCode || "";
        return `${t},${r.method},${r.total},${pickup},${r.id},${r.source},${
          raw.who || ""
        },${raw.orderId || ""}`;
      }),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${from}_to_${to}${q ? `_q-${q}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Topbar title="交易紀錄" />

      <Card title="篩選" className="span-12" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "end",
            flexWrap: "wrap",
          }}
        >
          <label>
            自：
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label>
            至：
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <label>
            付款方式：
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
            >
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          {/* ✅ 顯示搜尋字（來自 #/tx?q=） */}
          <div style={{ fontSize: 13, color: "#64748b" }}>
            搜尋：<b>{q || "-"}</b>
          </div>

          <button onClick={load} disabled={busy}>
            {busy ? "查詢中…" : "查詢"}
          </button>

          {/* ✅ 這裡要看 q，不是 search */}
          {q && (
            <button
              onClick={() => {
                clearQInHash(); // 會觸發 hashchange → setQ("")
                // 你也可以選擇不 load()，因為 rows 本來就全資料，q 清掉就會自動回全表
                // 但如果你想要「順便重抓最新資料」，就保留：
                load();
              }}
              style={{
                padding: "6px 10px",
                fontSize: 13,
                border: "1px solid #e5e7eb",
                background: "#fff",
                borderRadius: 8,
                color: "#64748b",
              }}
            >
              ✕ 清除搜尋
            </button>
          )}

          <button onClick={exportCSV} disabled={busy || filtered.length === 0}>
            匯出 CSV
          </button>

          <div style={{ marginLeft: "auto", fontWeight: 700 }}>
            總金額：{money(totalSum)}
          </div>
        </div>

        <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
          已合併：transactions + checkout_requests(verified)
          {q ? "｜已套用搜尋條件" : ""}
        </div>
      </Card>

      <Card title="清單" className="span-12 card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th
                  align="left"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  時間
                </th>
                <th
                  align="left"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  付款方式
                </th>
                <th
                  align="right"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  金額
                </th>
                <th
                  align="left"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  取貨碼
                </th>
                <th
                  align="left"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  ID
                </th>
                <th
                  align="left"
                  style={{ padding: "10px 8px", color: "#64748b" }}
                >
                  來源
                </th>
              </tr>
            </thead>

            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.source}-${r.id}`}>
                  <td
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {r.ts ? fmtDateTime(r.ts) : "-"}
                  </td>
                  <td
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {r.method}
                  </td>
                  <td
                    align="right"
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {money(r.total)}
                  </td>
                  <td
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {r.raw?.pickupCode || "-"}
                  </td>
                  <td
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {r.id}
                  </td>
                  <td
                    style={{
                      padding: "10px 8px",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  >
                    {r.source}
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  {/* ✅ 你現在有 6 欄，所以 colSpan 要 6 */}
                  <td colSpan={6} style={{ padding: 12, color: "#64748b" }}>
                    此期間沒有資料（或被篩選 / 搜尋條件排除）
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
