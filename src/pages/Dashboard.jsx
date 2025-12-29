// src/pages/Dashboard.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area,
  CartesianGrid,
} from "recharts";

const COLORS = ["#0ea567", "#16a34a", "#86efac", "#22c55e", "#a3e635", "#34d399"];

// ===== 日期工具 =====
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtMD(d) {
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")}`;
}
function money(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

// Firestore Timestamp / number / string -> Date
function toDateMaybeTs(v) {
  if (!v) return null;
  if (v?.toDate) return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  if (typeof v === "number") return new Date(v);
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ✅ 統一「事件時間」：checkout_requests 優先 verifiedAt，沒有就用 createdAt；transactions 用 ts
function pickEventTime(obj) {
  // checkout_requests
  if (obj?.verifiedAt) return toDateMaybeTs(obj.verifiedAt);
  if (obj?.createdAt) return toDateMaybeTs(obj.createdAt);

  // transactions
  if (obj?.ts) return toDateMaybeTs(obj.ts);

  // 兼容一些舊欄位
  if (obj?.timestamp) return toDateMaybeTs(obj.timestamp);
  return null;
}

function pickTotal(obj) {
  return Number(obj?.total || 0);
}

function pickMethod(obj) {
  // 你 checkout_requests 裡就是 method: "Face Pay"
  return obj?.method || obj?.payMethod || obj?.authMethod || "其他";
}

function pickKey(obj) {
  // 去重 key：同來源用 doc id
  if (obj?.source === "checkout_requests") return `cr:${obj.id}`;
  if (obj?.source === "transactions") return `tx:${obj.id}`;
  return `u:${obj.id || Math.random()}`;
}

export default function Dashboard() {
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [byHour, setByHour] = useState([]);
  const [byMethod, setByMethod] = useState([]);
  const [last7, setLast7] = useState([]);
  const [busy, setBusy] = useState(false);

  const avgTicket = useMemo(
    () => (todayCount ? Math.round((todayRevenue / todayCount) * 100) / 100 : 0),
    [todayRevenue, todayCount]
  );

  // ===== 讀 transactions（近 7 天）=====
  async function fetchTransactions(fromTs, toTs) {
    // 先試區間查
    try {
      const q1 = query(
        collection(db, "transactions"),
        where("ts", ">=", fromTs),
        where("ts", "<=", toTs),
        orderBy("ts", "asc"),
        limit(5000)
      );
      const snap = await getDocs(q1);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "transactions" }));
    } catch (e) {
      // fallback：全抓再前端過濾
      const qAll = query(collection(db, "transactions"), limit(5000));
      const snap = await getDocs(qAll);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "transactions" }));
    }
  }

  // ===== 讀 checkout_requests（只抓 status=verified）=====
  async function fetchCheckoutRequestsVerified(fromTs, toTs) {
    // ✅ 優先用 createdAt 做範圍（你資料一定有 createdAt）
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
      // ✅ fallback：只用 status==verified（通常不需要複合 index），再用前端過濾日期
      const q2 = query(
        collection(db, "checkout_requests"),
        where("status", "==", "verified"),
        limit(5000)
      );
      const snap = await getDocs(q2);
      return snap.docs.map((d) => ({ id: d.id, ...d.data(), source: "checkout_requests" }));
    }
  }

  const load = useCallback(async () => {
    const useDemo = (import.meta.env.VITE_USE_DEMO ?? "0") === "1";
    if (useDemo) {
      setTodayRevenue(1234);
      setTodayCount(27);
      setByHour([
        { h: "09", total: 80 },
        { h: "10", total: 120 },
        { h: "11", total: 140 },
        { h: "12", total: 90 },
        { h: "13", total: 110 },
        { h: "14", total: 70 },
        { h: "15", total: 160 },
      ]);
      setByMethod([
        { name: "Face Pay", value: 45 },
        { name: "RFID/卡片", value: 35 },
        { name: "現金", value: 20 },
      ]);
      setLast7([
        { d: "D-6", total: 420 },
        { d: "D-5", total: 510 },
        { d: "D-4", total: 460 },
        { d: "D-3", total: 780 },
        { d: "D-2", total: 620 },
        { d: "D-1", total: 550 },
        { d: "今天", total: 1234 },
      ]);
      return;
    }

    setBusy(true);
    try {
      const from = daysAgo(6);
      const to = endOfDay(new Date());
      const fromTs = Timestamp.fromDate(from);
      const toTs = Timestamp.fromDate(to);

      const [txs, reqs] = await Promise.all([
        fetchTransactions(fromTs, toTs),
        fetchCheckoutRequestsVerified(fromTs, toTs),
      ]);

      // 合併 + 去重
      const map = new Map();
      for (const row of [...txs, ...reqs]) {
        map.set(pickKey(row), row);
      }

      // 前端過濾日期（尤其是 fallback 的情況）
      const all = Array.from(map.values()).filter((row) => {
        const ts = pickEventTime(row);
        return ts && ts >= from && ts <= to;
      });

      // 依時間排序
      all.sort((a, b) => {
        const ta = pickEventTime(a)?.getTime() ?? 0;
        const tb = pickEventTime(b)?.getTime() ?? 0;
        return ta - tb;
      });

      // ===== 聚合 =====
      const todayStart = startOfDay(new Date());
      const todayEnd = endOfDay(new Date());

      let rev = 0;
      let cnt = 0;

      const hourArr = Array.from({ length: 24 }, (_, h) => ({
        h: String(h).padStart(2, "0"),
        total: 0,
      }));

      const methodMap = new Map();
      const dayMap = new Map();

      for (const row of all) {
        const ts = pickEventTime(row);
        if (!ts) continue;

        const total = pickTotal(row);
        const method = pickMethod(row);

        // 近7天每日
        const dayKey = fmtMD(ts);
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + total);

        // 今日 KPI / 今日每小時 / 今日付款方式
        if (ts >= todayStart && ts <= todayEnd) {
          rev += total;
          cnt += 1;
          hourArr[ts.getHours()].total += total;
          methodMap.set(method, (methodMap.get(method) || 0) + 1);
        }
      }

      setTodayRevenue(rev);
      setTodayCount(cnt);
      setByHour(hourArr.filter((x) => x.total > 0));
      setByMethod(Array.from(methodMap, ([name, value]) => ({ name, value })));

      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = daysAgo(i);
        const key = fmtMD(d);
        days.push({ d: i === 0 ? "今天" : key, total: dayMap.get(key) || 0 });
      }
      setLast7(days);

      // 你想快速確認 Face Pay 有沒有進來：看 console
      console.log("Dashboard merged counts:", {
        transactions: txs.length,
        checkout_requests: reqs.length,
        afterFilter: all.length,
        methodsToday: Array.from(methodMap.entries()),
      });
    } catch (e) {
      console.error("[Dashboard] 載入失敗：", e);
      alert(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
    return () => clearTimeout(id);
  }, [byHour.length, byMethod.length, last7.length]);

  const fillStyle = { width: "100%", minWidth: 0, flex: "1 1 0%" };
  const hLg = { height: 280 };
  const hSm = { height: 260 };

  return (
    <>
      <style>{`
        .dashboard-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px;align-items:stretch}
        .card,.card-body{min-width:0;width:100%}
        .card-body{display:flex;flex-direction:column}
        .chart-fill{min-width:0;width:100%}
      `}</style>

      <Topbar
        title="Dashboard"
        right={<span style={{ fontSize: 12, opacity: 0.7 }}>{busy ? "載入中…" : "已更新"}</span>}
      />

      <div className="dashboard-grid cols-12" style={{ marginBottom: 8 }}>
        <Card title="今日營收" className="span-4 card" style={{ gridColumn: "span 4 / span 4" }}>
          <div className="kpi">{money(todayRevenue)}</div>
        </Card>

        <Card title="今日交易筆數" className="span-4 card" style={{ gridColumn: "span 4 / span 4" }}>
          <div className="kpi">{todayCount}</div>
        </Card>

        <Card title="客單價" className="span-4 card" style={{ gridColumn: "span 4 / span 4" }}>
          <div className="kpi">{money(avgTicket)}</div>
        </Card>

        <Card title="今日每小時營收" style={{ gridColumn: "span 8 / span 8" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hLg }}>
            {byHour.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>今天尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byHour} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="h" />
                  <YAxis width={48} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="total" fill="#0ea567" radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card title="付款方式占比" style={{ gridColumn: "span 4 / span 4" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hSm }}>
            {byMethod.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b" }}>今天尚無資料</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byMethod} dataKey="value" nameKey="name" outerRadius={88} label>
                    {byMethod.map((_, idx) => (
                      <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(v) => `${v} 筆`} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card title="近 7 天營收趨勢" style={{ gridColumn: "span 12 / span 12" }}>
          <div className="chart-fill" style={{ ...fillStyle, ...hLg }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={last7} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea567" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#0ea567" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="d" />
                <YAxis width={48} />
                <Tooltip formatter={(v) => money(v)} />
                <Area type="monotone" dataKey="total" stroke="#0ea567" fill="url(#g)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </>
  );
}
