// src/pages/Reports.jsx
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
  doc,
  getDoc,
} from "firebase/firestore";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = ["#0ea567", "#16a34a", "#86efac", "#22c55e", "#a3e635", "#34d399"];

// ===== 日期工具 =====
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const toLocalISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function fmtMD(d) {
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}

function diffDays(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

function toDateMaybeTs(v) {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

export default function Reports() {
  // ✅ 預設 7 天（含今天）
  const [from, setFrom] = useState(toLocalISODate(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(toLocalISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const [kpi, setKpi] = useState({ revenue: 0, count: 0, avg: 0 });
  const [byDay, setByDay] = useState([]); // [{d:'12/11', total:0}]
  const [byMethod, setByMethod] = useState([]); // [{name:'Face Pay', value: 3}]
  const [top5, setTop5] = useState([]);
  const [restock, setRestock] = useState([]);

  const hasData = useMemo(
    () => byDay.some((x) => Number(x.total) > 0) || byMethod.length > 0,
    [byDay, byMethod]
  );

  async function fetchStock(productId) {
    const snap = await getDoc(doc(db, "products", productId));
    if (!snap.exists()) return 0;
    return Number(snap.data().stock || 0);
  }

  async function buildRestockSuggestion(top, fromStr, toStr) {
    const days = Math.max(1, diffDays(fromStr, toStr));
    const safetyDays = 7;

    const result = [];
    for (const p of top) {
      const stock = await fetchStock(p.productId);
      const avg = p.qty / days;
      const target = Math.ceil(avg * safetyDays);
      const need = Math.max(0, target - stock);

      result.push({
        ...p,
        stock,
        avg,
        need,
        level: need >= 5 ? "🔴" : need >= 1 ? "🟡" : "🟢",
      });
    }
    result.sort((a, b) => b.need - a.need);
    return result;
  }

  // ✅ 讀 transactions（ts 範圍）
  async function fetchTransactions(fromTs, toTs) {
    const q1 = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "asc"),
      limit(5000)
    );
    const snap = await getDocs(q1);
    return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "transactions" }));
  }

  // ✅ 讀 checkout_requests：status=verified（先用 createdAt 範圍；不行就 fallback）
  async function fetchCheckoutRequestsVerified(fromTs, toTs) {
    try {
      const q1 = query(
        collection(db, "checkout_requests"),
        where("status", "==", "verified"),
        where("createdAt", ">=", fromTs),
        where("createdAt", "<=", toTs),
        orderBy("createdAt", "asc"),
        limit(5000)
      );
      const snap = await getDocs(q1);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "checkout_requests" }));
    } catch (e) {
      const q2 = query(
        collection(db, "checkout_requests"),
        where("status", "==", "verified"),
        limit(5000)
      );
      const snap = await getDocs(q2);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "checkout_requests" }));
    }
  }

  const load = async () => {
    setBusy(true);
    try {
      const fromDate = startOfDay(new Date(from));
      const toDate = endOfDay(new Date(to));
      const fromTs = Timestamp.fromDate(fromDate);
      const toTs = Timestamp.fromDate(toDate);

      const [txs, reqs] = await Promise.all([
        fetchTransactions(fromTs, toTs),
        fetchCheckoutRequestsVerified(fromTs, toTs),
      ]);

      let revenue = 0;
      let count = 0;
      const dayMap = new Map();
      const methodMap = new Map();
      const productMap = {};

      // 合併 + 去重
      const keyMap = new Map();
      for (const t of txs) keyMap.set(`tx:${t.id}`, t);
      for (const r of reqs) keyMap.set(`cr:${r.id}`, r);

      const all = Array.from(keyMap.values())
        .map((row) => {
          const ts =
            toDateMaybeTs(row.ts) ||
            toDateMaybeTs(row.verifiedAt) ||
            toDateMaybeTs(row.createdAt) ||
            null;
          return { ...row, _ts: ts };
        })
        .filter((row) => row._ts && row._ts >= fromDate && row._ts <= toDate)
        .sort((a, b) => a._ts - b._ts);

      for (const row of all) {
        const total = Number(row.total || 0) || 0;
        const method = row.method || row.payMethod || row.authMethod || "其他";

        revenue += total;
        count += 1;

        const dayKey = fmtMD(row._ts);
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + total);
        methodMap.set(method, (methodMap.get(method) || 0) + 1);

        const items = Array.isArray(row.items) ? row.items : [];
        for (const it of items) {
          const pid = it.productId || it.productID || it.pid || it.sku || null;
          const name = it.name || it.title || "未命名商品";
          const qty = Number(it.qty ?? it.quantity ?? 0);
          const price = Number(it.price ?? 0);

          if (!pid) continue;

          if (!productMap[pid]) {
            productMap[pid] = { productId: pid, name, qty: 0, revenue: 0 };
          }
          productMap[pid].qty += qty;
          productMap[pid].revenue += qty * price;
        }
      }

      // 補 0：from~to 每一天都有
      const days = [];
      for (let d = new Date(fromDate); d <= toDate; d = new Date(d.getTime() + 86400000)) {
        const key = fmtMD(d);
        days.push({ d: key, total: dayMap.get(key) || 0 });
      }

      setKpi({
        revenue,
        count,
        avg: count ? Math.round((revenue / count) * 100) / 100 : 0,
      });
      setByDay(days);
      setByMethod(Array.from(methodMap, ([name, value]) => ({ name, value })));

      const top = Object.values(productMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
      setTop5(top);

      const suggestion = await buildRestockSuggestion(top, from, to);
      setRestock(suggestion);
    } catch (e) {
      console.error(e);
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportSummaryCSV = () => {
    const lines = [
      "項目,數值",
      `總營收,${kpi.revenue}`,
      `交易筆數,${kpi.count}`,
      `客單價,${kpi.avg}`,
      "",
      "日期,日營收",
      ...byDay.map((r) => `${r.d},${r.total}`),
      "",
      "付款方式,筆數",
      ...byMethod.map((r) => `${r.name},${r.value}`),
      "",
      "熱銷商品Top5,售出,營收,日均,庫存,建議進貨",
      ...restock.map(
        (r) => `${r.name},${r.qty},${r.revenue},${r.avg.toFixed(2)},${r.stock},${r.need}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const CHART_H = 220;

  return (
    <>
      {/* ✅ 這段就是修你截圖那個「卡片被擠爆」的關鍵 */}
      <style>{`
        .dashboard-grid{
          display:grid;
          grid-template-columns:repeat(12,minmax(0,1fr));
          gap:12px;
          align-items:stretch;
        }
        .card,.card-body{min-width:0;width:100%}
        .card-body{display:flex;flex-direction:column}
        .chartBox{width:100%;min-width:0;overflow:hidden}

        /* KPI 自動縮放，避免 $4,00 被切掉 */
        .kpi{
          font-size: clamp(22px, 4.5vw, 44px);
          font-weight: 800;
          letter-spacing: .5px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        /* 小螢幕：全部一排一張，不再擠成細條 */
        @media (max-width: 900px){
          .span-4,.span-8,.span-12{ grid-column: span 12 / span 12 !important; }
        }
      `}</style>

      <Topbar title="Analytics / 報表" />

      {/* 期間 */}
      <Card title="期間" className="span-12" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label>
            自：
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            至：
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>

          <button onClick={load} disabled={busy}>
            {busy ? "處理中…" : "產生報表"}
          </button>

          <button onClick={exportSummaryCSV} disabled={busy || byDay.length === 0}>
            匯出 CSV
          </button>
        </div>

        {!busy && !hasData && (
          <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
            此期間沒有資料（transactions / checkout_requests verified 都為空）。把日期調到有交易的期間。
          </div>
        )}
      </Card>

      {/* KPI */}
      <div className="dashboard-grid cols-12" style={{ marginBottom: 12 }}>
        <Card title="總營收" className="span-4 card">
          <div className="kpi">{money(kpi.revenue)}</div>
        </Card>
        <Card title="交易筆數" className="span-4 card">
          <div className="kpi">{kpi.count}</div>
        </Card>
        <Card title="客單價" className="span-4 card">
          <div className="kpi">{money(kpi.avg)}</div>
        </Card>
      </div>

      {/* 圖表 */}
      <div className="dashboard-grid cols-12" style={{ marginBottom: 12 }}>
        <Card title="日營收趨勢" className="span-8 card">
          <div className="chartBox" style={{ height: CHART_H }}>
            {byDay.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>此期間尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byDay}
                  margin={{ top: 8, right: 12, left: 12, bottom: 0 }}   // ✅ left 留空避免軸被吃掉
                  barCategoryGap="30%"
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="d" tickMargin={6} />
                  <YAxis width={48} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="total" fill="#0ea567" radius={[8, 8, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card title="付款方式占比" className="span-4 card">
          <div className="chartBox" style={{ height: CHART_H }}>
            {byMethod.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>此期間尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byMethod}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {byMethod.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend verticalAlign="bottom" height={44} />
                  <Tooltip formatter={(v) => `${v} 筆`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Top5 + 進貨建議 */}
      <Card title="校售熱銷商品 Top 5 & 進貨建議" className="span-12 card">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          {/* 左：Top 5（可滾動） */}
          <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
                <tr>
                  <th align="left" style={{ padding: "8px 4px", color: "#64748b" }}>
                    商品
                  </th>
                  <th align="right" style={{ padding: "8px 4px", color: "#64748b" }}>
                    售出
                  </th>
                  <th align="right" style={{ padding: "8px 4px", color: "#64748b" }}>
                    營收
                  </th>
                </tr>
              </thead>
              <tbody>
                {top5.map((p) => (
                  <tr key={p.productId}>
                    <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {p.name}
                    </td>
                    <td
                      align="right"
                      style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}
                    >
                      {p.qty}
                    </td>
                    <td
                      align="right"
                      style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}
                    >
                      {money(p.revenue)}
                    </td>
                  </tr>
                ))}
                {top5.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ opacity: 0.6, padding: "10px 4px" }}>
                      此期間尚無商品資料
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 右：進貨建議（可滾動） */}
          <div style={{ maxHeight: 320, overflowY: "auto", paddingRight: 6 }}>
            {restock.map((r) => (
              <div
                key={r.productId}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 12,
                  background: "#fff",
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {r.level} {r.name}
                </div>
                <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6 }}>
                  <div>平均每日銷量：{r.avg.toFixed(2)}</div>
                  <div>目前庫存：{r.stock}</div>
                  <div>
                    建議進貨：
                    <b style={{ marginLeft: 6 }}>{r.need > 0 ? `+${r.need}` : "不需進貨"}</b>
                  </div>
                </div>
              </div>
            ))}
            {restock.length === 0 && <div style={{ opacity: 0.6 }}>此期間尚無進貨建議</div>}
          </div>
        </div>
      </Card>
    </>
  );
}
