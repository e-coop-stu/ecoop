import React, { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";

function fmtDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? d.toLocaleDateString() : "-";
  } catch {
    return "-";
  }
}

function levelText(level) {
  if (level === "expired") return "🔴 已過期";
  if (level === "near") return "🟡 快過期";
  return "🟢 正常";
}

export default function Notifications() {
  const [busy, setBusy] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(true);
  const [rows, setRows] = useState([]);

  const unreadCount = useMemo(
    () => rows.filter((r) => !r.read).length,
    [rows]
  );

  const filtered = useMemo(() => {
    if (!onlyUnread) return rows;
    return rows.filter((r) => !r.read);
  }, [rows, onlyUnread]);

  async function load() {
    setBusy(true);
    try {
      const q1 = query(
        collection(db, "notifications"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
      const snap = await getDocs(q1);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRows(list);
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id) {
    await updateDoc(doc(db, "notifications", id), {
      read: true,
      readAt: serverTimestamp(),
    });
    // 更新本地狀態（不用再整頁重抓也行）
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, read: true } : r))
    );
  }

  async function markAllRead() {
    // 簡單版：逐筆標已讀（200筆內可接受）
    const targets = rows.filter((r) => !r.read).slice(0, 50); // 避免一次太多
    for (const t of targets) {
      await markRead(t.id);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <Topbar title="通知中心" />

      <Card title="操作" className="span-12 card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={load} disabled={busy}>
            {busy ? "讀取中…" : "重新整理"}
          </button>

          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={(e) => setOnlyUnread(e.target.checked)}
            />
            只看未讀
          </label>

          <button onClick={markAllRead} disabled={busy || unreadCount === 0}>
            全部標為已讀（最多 50 筆）
          </button>

          <div style={{ marginLeft: "auto", opacity: 0.75 }}>
            未讀：<b>{unreadCount}</b> ／ 總數：<b>{rows.length}</b>
          </div>
        </div>
      </Card>

      <Card title="到期通知列表" className="span-12 card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#64748b", fontSize: 13 }}>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  狀態
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  商品
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  批次
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  到期日
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  建立時間
                </th>
                <th align="right" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr key={n.id} style={{ opacity: n.read ? 0.55 : 1 }}>
                  <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                    {levelText(n.level)}
                    {!n.read && <span style={{ marginLeft: 8, fontSize: 12 }}>🟦 未讀</span>}
                  </td>
                  <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                    {n.productName || n.productId || "-"}
                  </td>
                  <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                    {n.batchId ? String(n.batchId).slice(0, 8) + "…" : "-"}
                  </td>
                  <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                    {fmtDate(n.expiryAt)}
                  </td>
                  <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                    {fmtDate(n.createdAt)}
                  </td>
                  <td
                    align="right"
                    style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}
                  >
                    <button onClick={() => markRead(n.id)} disabled={busy || n.read}>
                      標記已讀
                    </button>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "12px 4px", opacity: 0.6 }}>
                    目前沒有通知（或你開啟了「只看未讀」但全都已讀）。
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
