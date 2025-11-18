import React, { useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  collection, query, where, orderBy, getDocs, Timestamp, limit
} from "firebase/firestore";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend
} from "recharts";

const COLORS = ["#0ea567", "#16a34a", "#86efac", "#22c55e", "#a3e635", "#34d399"];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
const toLocalISODate = (d=new Date()) => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);

export default function Reports() {
  const [from, setFrom] = useState(toLocalISODate(new Date(Date.now()-6*86400000)));
  const [to,   setTo]   = useState(toLocalISODate(new Date()));
  const [busy, setBusy] = useState(false);

  const [kpi, setKpi] = useState({ revenue:0, count:0, avg:0 });
  const [byDay, setByDay] = useState([]);     // [{d:'9/01', total:123}]
  const [byMethod, setByMethod] = useState([]); // [{name:'現金', value:10}]

  const load = async () => {
    setBusy(true);
    try {
      const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
      const toTs   = Timestamp.fromDate(endOfDay(new Date(to)));

      // 以 ts 篩選；必要時可分批取（這裡先 5000）
      const q = query(
        collection(db, "transactions"),
        where("ts", ">=", fromTs),
        where("ts", "<=", toTs),
        orderBy("ts", "asc"),
        limit(5000)
      );
      const snap = await getDocs(q);
      const tx = snap.docs.map(d => d.data());

      let revenue=0, count=0;
      const dayMap = new Map();
      const methodMap = new Map();

      for (const t of tx) {
        const ts = t.ts?.toDate ? t.ts.toDate()
                  : (t.ts?.seconds ? new Date(t.ts.seconds*1000) : null);
        const total = Number(t.total)||0;
        const method = t.method || t.payMethod || t.authMethod || "其他";
        if (!ts) continue;

        revenue += total; count += 1;
        const dayKey = `${ts.getMonth()+1}/${String(ts.getDate()).padStart(2,"0")}`;
        dayMap.set(dayKey, (dayMap.get(dayKey)||0) + total);
        methodMap.set(method, (methodMap.get(method)||0) + 1);
      }

      const days = [];
      // 依期間順序補零
      const fromD = startOfDay(new Date(from));
      for (let d = new Date(fromD); d <= endOfDay(new Date(to)); d = new Date(d.getTime()+86400000)) {
        const key = `${d.getMonth()+1}/${String(d.getDate()).padStart(2,"0")}`;
        days.push({ d:key, total: dayMap.get(key)||0 });
      }

      setKpi({ revenue, count, avg: count ? Math.round((revenue/count)*100)/100 : 0 });
      setByDay(days);
      setByMethod(Array.from(methodMap, ([name, value]) => ({ name, value })));
    } finally {
      setBusy(false);
    }
  };

  // 匯出彙總 CSV
  const exportSummaryCSV = () => {
    const lines = [
      "項目,數值",
      `總營收,${kpi.revenue}`,
      `交易筆數,${kpi.count}`,
      `客單價,${kpi.avg}`,
      "",
      "日期,日營收",
      ...byDay.map(r => `${r.d},${r.total}`),
      "",
      "付款方式,筆數",
      ...byMethod.map(r => `${r.name},${r.value}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `report_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Topbar title="報表" />
      <Card title="期間" className="span-12" style={{ marginBottom: 12 }}>
        <div style={{ display:"flex", gap:12, alignItems:"end", flexWrap:"wrap" }}>
          <label>自：<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
          <label>至：<input type="date" value={to}   onChange={e=>setTo(e.target.value)} /></label>
          <button onClick={load} disabled={busy}>{busy ? "處理中…" : "產生報表"}</button>
          <button onClick={exportSummaryCSV} disabled={busy || (byDay.length===0)}>匯出 CSV</button>
        </div>
      </Card>

      {/* KPI */}
      <div className="dashboard-grid cols-12" style={{ marginBottom: 12 }}>
        <Card title="總營收" className="kpi span-3 card kpi" style={{ gridColumn:"span 3 / span 3" }}>
          <div className="kpi">${kpi.revenue.toLocaleString()}</div>
        </Card>
        <Card title="交易筆數" className="kpi span-3 card kpi" style={{ gridColumn:"span 3 / span 3" }}>
          <div className="kpi">{kpi.count}</div>
        </Card>
        <Card title="客單價" className="kpi span-3 card kpi" style={{ gridColumn:"span 3 / span 3" }}>
          <div className="kpi">${kpi.avg.toLocaleString()}</div>
        </Card>
      </div>

      {/* 日營收曲線 */}
      <Card title="日營收趨勢" className="span-12 card chart-lg">
        <div className="chart-fill" style={{ width:"100%", height: 320, minWidth:0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={byDay}>
              <defs>
                <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea567" stopOpacity={0.6}/>
                  <stop offset="100%" stopColor="#0ea567" stopOpacity={0.05}/>
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="d" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="total" stroke="#0ea567" fill="url(#g2)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 付款方式占比 */}
      <Card title="付款方式占比" className="span-12 card chart-sm">
        <div className="chart-fill" style={{ width:"100%", height: 300, minWidth:0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byMethod} dataKey="value" nameKey="name" outerRadius={100} label>
                {byMethod.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
              </Pie>
              <Legend />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  );
}
