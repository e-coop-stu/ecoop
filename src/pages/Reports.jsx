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
  // Firestore Timestamp
  if (v?.toDate) return v.toDate();
  // {seconds, nanoseconds}
  if (v?.seconds) return new Date(v.seconds * 1000);
  // string/date
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
  const [byDay, setByDay] = useState([]);       // [{d:'12/11', total:0}]
  const [byMethod, setByMethod] = useState([]); // [{name:'Face Pay', value: 3}]

  // Top5 + 進貨建議（用 transactions/items 或 checkout_requests/items）
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

  // ✅ 讀 transactions（你原本就有）
  async function fetchTransactions(fromTs, toTs) {
    const q1 = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "asc"),
      limit(5000)
    );
    const snap = await getDocs(q1);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ✅ 讀 checkout_requests：只抓樹莓派完成的 verified（你的需求）
  async function fetchCheckoutRequestsVerified(fromTs, toTs) {
    // 注意：createdAt 用 serverTimestamp() 寫入時，才能用範圍查詢
    const q1 = query(
      collection(db, "checkout_requests"),
      where("status", "==", "verified"),
      where("createdAt", ">=", fromTs),
      where("createdAt", "<=", toTs),
      orderBy("createdAt", "asc"),
      limit(5000)
    );
    const snap = await getDocs(q1);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const load = async () => {
    setBusy(true);
    try {
      const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
      const toTs = Timestamp.fromDate(endOfDay(new Date(to)));

      // 同時抓兩個來源（避免你現在有些交易在 checkout_requests，還沒寫到 transactions）
      const [txs, reqs] = await Promise.all([
        fetchTransactions(fromTs, toTs),
        fetchCheckoutRequestsVerified(fromTs, toTs),
      ]);

      // ===== 統計容器 =====
      let revenue = 0;
      let count = 0;
      const dayMap = new Map();     // key: "12/11" -> money
      const methodMap = new Map();  // key: "Face Pay" -> count
      const productMap = {};        // pid -> {productId,name,qty,revenue}

      // ===== 合併成同一種資料結構計算 =====
      const all = [];

      // transactions
      for (const t of txs) {
        const ts = toDateMaybeTs(t.ts);
        if (!ts) continue;
        all.push({
          ts,
          total: Number(t.total || 0),
          method: t.method || t.payMethod || t.authMethod || "其他",
          items: Array.isArray(t.items) ? t.items : [],
          source: "transactions",
        });
      }

      // checkout_requests (verified)
      for (const r of reqs) {
        const ts = toDateMaybeTs(r.createdAt) || toDateMaybeTs(r.verifiedAt) || null;
        if (!ts) continue;
        all.push({
          ts,
          total: Number(r.total || 0),
          method: r.method || "其他",
          items: Array.isArray(r.items) ? r.items : [],
          source: "checkout_requests",
        });
      }

      // 依時間排序（漂亮一點）
      all.sort((a, b) => a.ts - b.ts);

      // ===== 主要累加 =====
      for (const row of all) {
        const total = Number(row.total) || 0;
        const method = row.method || "其他";

        revenue += total;
        count += 1;

        const dayKey = fmtMD(row.ts);
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + total);
        methodMap.set(method, (methodMap.get(method) || 0) + 1);

        for (const it of row.items || []) {
          // 你 checkout_requests 裡有 sku / productId 都可能
          const pid = it.productId || it.productID || it.pid || null;
          const name = it.name || it.title || "未命名商品";
          const qty = Number(it.qty || 0);
          const price = Number(it.price || 0);

          if (!pid) continue;

          if (!productMap[pid]) {
            productMap[pid] = {
              productId: pid,
              name,
              qty: 0,
              revenue: 0,
            };
          }
          productMap[pid].qty += qty;
          productMap[pid].revenue += qty * price;
        }
      }

      // ✅ 補 0：把 from~to 每一天都塞進去（柱狀才會完整）
      const days = [];
      const fromD = startOfDay(new Date(from));
      const toD = endOfDay(new Date(to));
      for (let d = new Date(fromD); d <= toD; d = new Date(d.getTime() + 86400000)) {
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
    }
  };

  // ✅ 進頁先跑一次（預設 7 天）
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

  // ✅ 讓圖表「矮一點、塞進 card」：你想要接近 svg 220x160 的比例
  // 這裡統一用高度 160（更矮），寬度交給 ResponsiveContainer 100%
  const CHART_H = 160;

  return (
    <>
      <Topbar title="報表" />

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
      <div className="dashboard-grid cols-12" style={{ marginBottom: 12, gap: 12 }}>
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

      {/* 圖表：左柱狀(日營收) + 右圓餅(付款方式) */}
      <div className="dashboard-grid cols-12" style={{ gap: 12, marginBottom: 12 }}>
        {/* ✅ 日營收：柱狀（補0後很好看） */}
        <Card title="日營收趨勢" className="span-8 card">
          <div style={{ width: "100%", height: CHART_H, minWidth: 0, overflow: "hidden" }}>
            {byDay.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>此期間尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={byDay}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="d" tickMargin={6} />
                  <YAxis width={40} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar
                    dataKey="total"
                    fill="#0ea567"
                    radius={[8, 8, 0, 0]}
                    // ✅ 讓柱子不要變超細
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* ✅ 付款方式占比：圓餅 */}
        <Card title="付款方式占比" className="span-4 card">
          <div style={{ width: "100%", height: CHART_H, minWidth: 0, overflow: "hidden" }}>
            {byMethod.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>此期間尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byMethod}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={42}
                    outerRadius={64}
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
          {/* 左：Top 5 */}
          <div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
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

          {/* 右：進貨建議 */}
          <div>
            {restock.map((r) => (
              <div
                key={r.productId}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 12,
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
