import React, { useState } from "react";
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
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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
const startOfDay = (d) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const toLocalISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

function diffDays(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000) + 1;
}

export default function Reports() {
  const [from, setFrom] = useState(
    toLocalISODate(new Date(Date.now() - 6 * 86400000))
  );
  const [to, setTo] = useState(toLocalISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const [kpi, setKpi] = useState({ revenue: 0, count: 0, avg: 0 });
  const [byDay, setByDay] = useState([]); // [{d:'9/01', total:123}]
  const [byMethod, setByMethod] = useState([]); // [{name:'現金', value:10}]

  // 🔥 新增：Top5 + 進貨建議
  const [top5, setTop5] = useState([]); // [{productId,name,qty,revenue}]
  const [restock, setRestock] = useState([]); // [{..., stock, avg, need, level}]

  async function fetchStock(productId) {
    // ✅ 你目前我先假設庫存在 inventory collection，欄位 stock
    // 如果你是 products/{id}.stock，跟我說我幫你改成 doc 讀取（更快）
    const q = query(
      collection(db, "inventory"),
      where("productId", "==", productId),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return 0;
    return Number(snap.docs[0].data().stock || 0);
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

  const load = async () => {
    setBusy(true);
    try {
      const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
      const toTs = Timestamp.fromDate(endOfDay(new Date(to)));

      const q = query(
        collection(db, "transactions"),
        where("ts", ">=", fromTs),
        where("ts", "<=", toTs),
        orderBy("ts", "asc"),
        limit(5000)
      );

      const snap = await getDocs(q);
      const tx = snap.docs.map((d) => d.data());

      let revenue = 0,
        count = 0;
      const dayMap = new Map();
      const methodMap = new Map();

      // 🔥 商品累加
      const productMap = {};

      for (const t of tx) {
        const ts = t.ts?.toDate ? t.ts.toDate() : null;
        if (!ts) continue;

        const total = Number(t.total) || 0;
        const method = t.method || t.payMethod || t.authMethod || "其他";

        revenue += total;
        count += 1;

        const dayKey = `${ts.getMonth() + 1}/${String(ts.getDate()).padStart(
          2,
          "0"
        )}`;
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + total);
        methodMap.set(method, (methodMap.get(method) || 0) + 1);

        // 🔥 items 統計 Top5
        for (const it of t.items || []) {
          const pid = it.productId;
          if (!pid) continue;

          if (!productMap[pid]) {
            productMap[pid] = {
              productId: pid,
              name: it.name || "未命名商品",
              qty: 0,
              revenue: 0,
            };
          }
          const qty = Number(it.qty || 0);
          const price = Number(it.price || 0);

          productMap[pid].qty += qty;
          productMap[pid].revenue += qty * price;
        }
      }

      // 日營收補零
      const days = [];
      const fromD = startOfDay(new Date(from));
      for (
        let d = new Date(fromD);
        d <= endOfDay(new Date(to));
        d = new Date(d.getTime() + 86400000)
      ) {
        const key = `${d.getMonth() + 1}/${String(d.getDate()).padStart(
          2,
          "0"
        )}`;
        days.push({ d: key, total: dayMap.get(key) || 0 });
      }

      setKpi({
        revenue,
        count,
        avg: count ? Math.round((revenue / count) * 100) / 100 : 0,
      });
      setByDay(days);
      setByMethod(Array.from(methodMap, ([name, value]) => ({ name, value })));

      // 🔥 Top5
      const top = Object.values(productMap)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      setTop5(top);

      // 🔥 進貨建議
      const suggestion = await buildRestockSuggestion(top, from, to);
      setRestock(suggestion);
    } finally {
      setBusy(false);
    }
  };

  // 匯出彙總 CSV（保留你原本 + 加 Top5）
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
        (r) =>
          `${r.name},${r.qty},${r.revenue},${r.avg.toFixed(2)},${r.stock},${r.need}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `report_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Topbar title="報表" />

      {/* 期間 */}
      <Card title="期間" className="span-12" style={{ marginBottom: 12 }}>
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
          <button onClick={load} disabled={busy}>
            {busy ? "處理中…" : "產生報表"}
          </button>
          <button onClick={exportSummaryCSV} disabled={busy || byDay.length === 0}>
            匯出 CSV
          </button>
        </div>
      </Card>

      {/* KPI */}
      <div className="dashboard-grid cols-12" style={{ marginBottom: 12 }}>
        <Card
          title="總營收"
          className="kpi span-3 card kpi"
          style={{ gridColumn: "span 3 / span 3" }}
        >
          <div className="kpi">${kpi.revenue.toLocaleString()}</div>
        </Card>
        <Card
          title="交易筆數"
          className="kpi span-3 card kpi"
          style={{ gridColumn: "span 3 / span 3" }}
        >
          <div className="kpi">{kpi.count}</div>
        </Card>
        <Card
          title="客單價"
          className="kpi span-3 card kpi"
          style={{ gridColumn: "span 3 / span 3" }}
        >
          <div className="kpi">${kpi.avg.toLocaleString()}</div>
        </Card>
      </div>

      {/* 日營收曲線 */}
      <Card title="日營收趨勢" className="span-12 card chart-lg">
        <div className="chart-fill" style={{ width: "100%", height: 320, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={byDay}>
              <defs>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea567" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#0ea567" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="d" />
              <YAxis />
              <Tooltip />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#0ea567"
                fill="url(#g2)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 付款方式占比 */}
      <Card title="付款方式占比" className="span-12 card chart-sm">
        <div className="chart-fill" style={{ width: "100%", height: 300, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={byMethod}
                dataKey="value"
                nameKey="name"
                outerRadius={100}
                label
              >
                {byMethod.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ✅ Top5 + 進貨建議（外觀一致版） */}
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
            <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th align="left">商品</th>
                  <th align="right">售出</th>
                  <th align="right">營收</th>
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
                      ${p.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))}
                {top5.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ opacity: 0.6, padding: "10px 4px" }}>
                      此期間尚無商品資料（請先按「產生報表」）
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
                    <b style={{ marginLeft: 6 }}>
                      {r.need > 0 ? `+${r.need}` : "不需進貨"}
                    </b>
                  </div>
                </div>
              </div>
            ))}

            {restock.length === 0 && (
              <div style={{ opacity: 0.6 }}>尚無進貨建議（請先按「產生報表」）</div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
