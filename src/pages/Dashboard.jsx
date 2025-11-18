import React, { useEffect, useState, useMemo, useCallback } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";

import {
  collection, query, where, orderBy, getDocs, addDoc,
  Timestamp, limit
} from "firebase/firestore";

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid
} from "recharts";

const COLORS = ["#0ea567", "#16a34a", "#86efac", "#22c55e", "#a3e635", "#34d399"];

// --- 小工具 ---
function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0); }
function endOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999); }
function daysAgo(n){ const d = new Date(); d.setDate(d.getDate()-n); d.setHours(0,0,0,0); return d; }

// --- 內建新增表單（免另外建檔） ---
function AddTransactionForm({ onAdded }) {
  const [total, setTotal] = useState("");
  const [method, setMethod] = useState("Face Pay");
  const [when, setWhen] = useState(() => {
    const t = new Date();
    const iso = new Date(t.getTime() - t.getTimezoneOffset() * 60000)
      .toISOString().slice(0,16);
    return iso;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      await addDoc(collection(db, "transactions"), {
        ts: Timestamp.fromDate(new Date(when)),
        total: Number(total),
        method
      });
      setMsg("✅ 已新增！");
      setTotal("");
      onAdded?.();
    } catch (err) {
      setMsg("新增失敗：" + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}
      style={{display:"grid",gridTemplateColumns:"1fr 1fr 1.4fr auto",gap:8,alignItems:"end",margin:"12px 0"}}
    >
      <label style={{display:"grid",gap:4}}>
        金額
        <input type="number" min="0" step="1" value={total}
          onChange={e=>setTotal(e.target.value)} required />
      </label>

      <label style={{display:"grid",gap:4}}>
        付款方式
        <select value={method} onChange={e=>setMethod(e.target.value)}>
          <option>Face Pay</option>
          <option>RFID/卡片</option>
          <option>現金</option>
        </select>
      </label>

      <label style={{display:"grid",gap:4}}>
        時間
        <input type="datetime-local" value={when}
          onChange={e=>setWhen(e.target.value)} required />
      </label>

      <button type="submit" disabled={busy || !total}>{busy ? "處理中…" : "新增"}</button>
      {msg && <div style={{gridColumn:"1 / -1", color:"#0ea567"}}>{msg}</div>}
    </form>
  );
}

export default function Dashboard() {
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayCount, setTodayCount]     = useState(0);
  const [byHour, setByHour]             = useState([]);
  const [byMethod, setByMethod]         = useState([]);
  const [last7, setLast7]               = useState([]);

  const avgTicket = useMemo(
    () => (todayCount ? Math.round((todayRevenue / todayCount) * 100) / 100 : 0),
    [todayRevenue, todayCount]
  );

  // 自動辨識各種時間欄位
  const pickTs = (t) => {
    if (t?.ts?.toDate) return t.ts.toDate();
    if (t?.timestamp?.toDate) return t.timestamp.toDate();
    if (t?.createdAt?.toDate) return t.createdAt.toDate();
    if (typeof t?.ts === "number") return new Date(t.ts);
    if (t?.ts?.seconds) return new Date(t.ts.seconds * 1000);
    return null;
  };

  const load = useCallback(async () => {
    const useDemo = (import.meta.env.VITE_USE_DEMO ?? "0") === "1";
    if (useDemo){
      console.info("[Dashboard] DEMO 模式：使用假資料（VITE_USE_DEMO=1）");
      setTodayRevenue(1234); setTodayCount(27);
      setByHour([
        { h:"09", total: 80 }, { h:"10", total: 120 }, { h:"11", total: 140 },
        { h:"12", total: 90 }, { h:"13", total: 110 }, { h:"14", total: 70 },
        { h:"15", total: 160 }
      ]);
      setByMethod([{ name:"Face Pay", value:45 },{ name:"RFID/卡片", value:35 },{ name:"現金", value:20 }]);
      setLast7([
        { d:"D-6", total: 420 }, { d:"D-5", total: 510 }, { d:"D-4", total: 460 },
        { d:"D-3", total: 780 }, { d:"D-2", total: 620 }, { d:"D-1", total: 550 }, { d:"今天", total: 1234 },
      ]);
      return;
    }

    try {
      const from = daysAgo(6);
      const to   = endOfDay(new Date());

      // 優先用 ts 區間查詢；失敗或為空則 fallback 全量
      let snap = null;
      try {
        const q1 = query(
          collection(db, "transactions"),
          where("ts", ">=", Timestamp.fromDate(from)),
          where("ts", "<=", Timestamp.fromDate(to)),
          orderBy("ts", "asc"),
          limit(2000)
        );
        snap = await getDocs(q1);
        console.info("[Dashboard] range(ts) 筆數:", snap.size);
      } catch (e) {
        console.warn("[Dashboard] range 查詢失敗，改用 fallback：", e?.message || e);
      }
      if (!snap || snap.empty) {
        const qAll = query(collection(db, "transactions"), limit(2000));
        snap = await getDocs(qAll);
        console.info("[Dashboard] fallback 全量筆數:", snap.size);
      }

      const tx = snap.docs.map(d => d.data());

      // 聚合
      const start = startOfDay(new Date());
      const end   = endOfDay(new Date());
      let rev = 0, cnt = 0;
      const hour = Array.from({length:24}, (_,h)=>({h:String(h).padStart(2,"0"), total:0}));
      const methodMap = new Map();
      const dayMap = new Map();

      for (const t of tx){
        const ts = pickTs(t);
        const total = Number(t.total) || 0;
        const method = t.method || t.payMethod || t.authMethod || "其他";
        if (!ts) continue;

        const dayKey = `${ts.getMonth()+1}/${String(ts.getDate()).padStart(2,"0")}`;
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + total);

        if (ts >= start && ts <= end){
          rev += total; cnt += 1;
          hour[ts.getHours()].total += total;
          methodMap.set(method, (methodMap.get(method) || 0) + 1);
        }
      }

      setTodayRevenue(rev);
      setTodayCount(cnt);
      setByHour(hour.filter(d => d.total > 0));
      setByMethod(Array.from(methodMap, ([name, value]) => ({ name, value })));

      const days = [];
      for (let i=6;i>=0;i--){
        const d = daysAgo(i);
        const key = `${d.getMonth()+1}/${String(d.getDate()).padStart(2,"0")}`;
        days.push({ d: i===0 ? "今天" : key, total: dayMap.get(key)||0 });
      }
      setLast7(days);

      console.info("[Dashboard] 聚合完成：todayRevenue=", rev, " todayCount=", cnt);
    } catch (e) {
      console.error("[Dashboard] 載入失敗：", e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 讓 ResponsiveContainer 在首次渲染後量到尺寸
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => clearTimeout(id);
  }, [byHour.length, byMethod.length, last7.length]);

  // 統一外層樣式：保證有寬/高
  const fillStyle = { width: "100%", minWidth: 0, flex: "1 1 0%" };
  const hLg = { height: 280 };
  const hSm = { height: 260 };

  return (
    <>
      {/* 保護性 CSS（不動外部檔案） */}
      <style>{`
        .dashboard-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;align-items:stretch}
        .card,.card-body{min-width:0;width:100%}
        .card-body{display:flex;flex-direction:column}
        .chart-fill{min-width:0;width:100%}
      `}</style>

      <Topbar title="Dashboard" right={<span className="badge">今天</span>} />

      {/* 內建新增表單：送出後自動重抓資料 */}
      <AddTransactionForm onAdded={load} />

      <div className="dashboard-grid cols-12" style={{ marginBottom: 8 }}>
        {/* KPI（三張各佔 3 欄） */}
        <Card title="今日營收" className="kpi span-3 card kpi" style={{ gridColumn: "span 3 / span 3" }}>
          <div className="kpi">${todayRevenue.toLocaleString()}</div>
        </Card>

        <Card title="今日交易筆數" className="kpi span-3 card kpi" style={{ gridColumn: "span 3 / span 3" }}>
          <div className="kpi">{todayCount}</div>
        </Card>

        <Card title="客單價" className="kpi span-3 card kpi" style={{ gridColumn: "span 3 / span 3" }}>
          <div className="kpi">${avgTicket.toLocaleString()}</div>
        </Card>

        {/* 今日每小時營收（佔 6 欄） */}
        <Card title="今日每小時營收" className="chart-lg" style={{ gridColumn: "span 6 / span 6" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hLg }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byHour}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="h" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill="#0ea567" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 付款方式占比（佔 3 欄） */}
        <Card title="付款方式占比" className="chart-sm" style={{ gridColumn: "span 3 / span 3" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hSm }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byMethod} dataKey="value" nameKey="name" outerRadius={80} label>
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

        

        {/* 近 7 天營收趨勢（佔 6 欄） */}
        <Card title="近 7 天營收趨勢" className="span-5 card chart-lg" style={{ gridColumn: "span 6 / span 6" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hLg }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last7}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea567" stopOpacity={0.6}/>
                    <stop offset="100%" stopColor="#0ea567" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="d" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="total" stroke="#0ea567" fill="url(#g)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}
