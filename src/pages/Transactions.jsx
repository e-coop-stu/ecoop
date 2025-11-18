import React, { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  collection, query, where, orderBy, limit, getDocs,
  startAfter, Timestamp
} from "firebase/firestore";

// 小工具
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay   = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
const toLocalISODate = (d=new Date()) => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);

export default function Transactions() {
  // 篩選條件
  const [from, setFrom] = useState(toLocalISODate(new Date()));
  const [to,   setTo]   = useState(toLocalISODate(new Date()));
  const [method, setMethod] = useState(""); // 空字串 = 全部

  // 資料 & 載入狀態
  const PAGE = 20;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);

  // 金額總計
  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.total)||0), 0), [rows]);

  // 查詢一次（重設）
  const search = async () => {
    setLoading(true);
    setRows([]); setCursor(null); setHasMore(true);
    await loadPage(true);
    setLoading(false);
  };

  // 分頁載入
  const loadPage = async (reset=false) => {
    if (!hasMore && !reset) return;
    setLoading(true);

    const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
    const toTs   = Timestamp.fromDate(endOfDay(new Date(to)));

    // 只用 ts 篩選 + 排序，method 先在前端過濾（避免需要建立複合索引）
    let q = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "desc"),
      limit(PAGE)
    );
    if (cursor) q = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "desc"),
      startAfter(cursor),
      limit(PAGE)
    );

    const snap = await getDocs(q);
    let data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 前端 method 過濾（避免索引）
    if (method) data = data.filter(r => (r.method || r.payMethod || r.authMethod) === method);

    setRows(prev => reset ? data : [...prev, ...data]);
    setCursor(snap.docs.at(-1) || null);
    setHasMore(snap.size === PAGE);
    setLoading(false);
  };

  // 首次載入
  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  // 匯出 CSV（依目前篩選）
  const exportCSV = async () => {
    const fromTs = Timestamp.fromDate(startOfDay(new Date(from)));
    const toTs   = Timestamp.fromDate(endOfDay(new Date(to)));

    let q = query(
      collection(db, "transactions"),
      where("ts", ">=", fromTs),
      where("ts", "<=", toTs),
      orderBy("ts", "desc"),
      limit(1000)
    );

    let all = [], last = null;
    do {
      const snap = await getDocs(last
        ? query(collection(db,"transactions"),
            where("ts",">=",fromTs), where("ts","<=",toTs),
            orderBy("ts","desc"), startAfter(last), limit(1000))
        : q
      );
      let batch = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      if (method) batch = batch.filter(r => (r.method || r.payMethod || r.authMethod) === method);
      all = all.concat(batch);
      last = snap.docs.at(-1) || null;
      if (snap.size < 1000) break;
    } while (true);

    const header = ["id","ts","total","method"];
    const lines = [header.join(",")].concat(
      all.map(r => {
        const ts = r.ts?.toDate ? r.ts.toDate() : (r.ts?.seconds ? new Date(r.ts.seconds*1000) : "");
        const iso = ts ? ts.toISOString() : "";
        const m = r.method || r.payMethod || r.authMethod || "";
        return [r.id, iso, r.total, m].map(v => `"${String(v??"").replace(/"/g,'""')}"`).join(",");
      })
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `transactions_${from}_to_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Topbar title="交易紀錄" />
      <Card title="篩選" className="span-12" style={{ marginBottom: 12 }}>
        <div style={{ display:"flex", gap:12, alignItems:"end", flexWrap:"wrap" }}>
          <label>自：<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label>
          <label>至：<input type="date" value={to}   onChange={e=>setTo(e.target.value)} /></label>
          <label>
            付款方式：
            <select value={method} onChange={e=>setMethod(e.target.value)}>
              <option value="">全部</option>
              <option>Face Pay</option>
              <option>RFID/卡片</option>
              <option>現金</option>
            </select>
          </label>
          <button onClick={search} disabled={loading}>查詢</button>
          <button onClick={exportCSV} disabled={loading}>匯出 CSV</button>
        </div>
      </Card>

      <Card title={`結果（${rows.length} 筆，金額合計 $${total.toLocaleString()}）`} className="span-12">
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", padding:8 }}>時間</th>
                <th style={{ textAlign:"left", padding:8 }}>付款方式</th>
                <th style={{ textAlign:"right", padding:8 }}>金額</th>
                <th style={{ textAlign:"left", padding:8 }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const ts = r.ts?.toDate ? r.ts.toDate()
                  : (r.ts?.seconds ? new Date(r.ts.seconds*1000) : null);
                const m  = r.method || r.payMethod || r.authMethod || "";
                return (
                  <tr key={r.id} style={{ borderTop:"1px solid #eee" }}>
                    <td style={{ padding:8 }}>{ts ? ts.toLocaleString() : "-"}</td>
                    <td style={{ padding:8 }}>{m}</td>
                    <td style={{ padding:8, textAlign:"right" }}>${Number(r.total||0).toLocaleString()}</td>
                    <td style={{ padding:8, fontFamily:"monospace" }}>{r.id}</td>
                  </tr>
                );
              })}
              {rows.length===0 && !loading && (
                <tr><td colSpan={4} style={{ padding:12, color:"#999" }}>沒有資料</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", padding:12 }}>
          <button onClick={()=>loadPage(false)} disabled={!hasMore || loading}>
            {loading ? "載入中…" : (hasMore ? "載入更多" : "沒有更多了")}
          </button>
        </div>
      </Card>
    </>
  );
}
