import React, { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

const toLocalISODate = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function daysLeft(expiryAt) {
  const today = startOfDay(new Date());
  const exp = startOfDay(expiryAt);
  return Math.floor((exp - today) / 86400000);
}
function getLevel(expiryAt, alertDays = 7) {
  const left = daysLeft(expiryAt);
  if (left < 0) return { level: "expired", text: "🔴 已過期", left };
  if (left <= alertDays) return { level: "near", text: "🟡 快過期", left };
  return { level: "ok", text: "🟢 正常", left };
}
function toTs(dateStr) {
  return Timestamp.fromDate(new Date(dateStr + "T00:00:00"));
}

export default function Inventory() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 🔔 通知掃描狀態
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  // 商品清單
  const [products, setProducts] = useState([]); // [{id, name, sku, barcode, price, stock, expiryAlertDays}]
  const [productId, setProductId] = useState("");

  const currentProduct = useMemo(
    () => products.find((p) => p.id === productId) || null,
    [products, productId]
  );

  // ✅ 商品編輯表單（把你原本商品編輯加回來）
  const [pForm, setPForm] = useState({
    name: "",
    sku: "",
    barcode: "",
    price: 0,
    stock: 0,
  });

  // 到期提醒天數（寫回 products.expiryAlertDays）
  const [alertDays, setAlertDays] = useState(7);

  // 新增批次輸入
  const [qty, setQty] = useState(1);
  const [expiryDate, setExpiryDate] = useState(
    toLocalISODate(new Date(Date.now() + 14 * 86400000))
  );

  // 批次資料
  const [batches, setBatches] = useState([]); // [{id, qty, expiryAt, receivedAt}]

  async function loadProducts() {
    const snap = await getDocs(
      query(collection(db, "products"), orderBy("name", "asc"))
    );
    const list = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));
    setProducts(list);

    if (!productId && list.length > 0) {
      setProductId(list[0].id);
    }
  }

  async function ensureInventoryDoc(pid) {
    await setDoc(
      doc(db, "inventory", pid),
      { updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  async function loadBatches(pid) {
    const q1 = query(
      collection(db, "inventory", pid, "batches"),
      orderBy("expiryAt", "asc")
    );
    const snap = await getDocs(q1);
    setBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }

  async function loadProductAlertDays(pid) {
    const pRef = doc(db, "products", pid);
    const pSnap = await getDoc(pRef);
    if (!pSnap.exists()) {
      setAlertDays(7);
      return;
    }
    const data = pSnap.data();
    setAlertDays(Number(data.expiryAlertDays || 7));
  }

  // ✅ 當選擇商品改變，把商品資料同步到編輯表單
  useEffect(() => {
    if (!currentProduct) return;
    setPForm({
      name: currentProduct.name || "",
      sku: currentProduct.sku || "",
      barcode: currentProduct.barcode || "",
      price: Number(currentProduct.price || 0),
      stock: Number(currentProduct.stock || 0),
    });
  }, [currentProduct]);

  // ✅ 儲存商品編輯
  async function saveProductEdit() {
    setMsg("");
    if (!productId) return;

    setBusy(true);
    try {
      await updateDoc(doc(db, "products", productId), {
        name: String(pForm.name || "").trim(),
        sku: String(pForm.sku || "").trim(),
        barcode: String(pForm.barcode || "").trim(),
        price: Number(pForm.price || 0),
        stock: Number(pForm.stock || 0),
        updatedAt: serverTimestamp(),
      });

      setMsg("✅ 商品資料已更新");
      await loadProducts();
    } catch (e) {
      console.error(e);
      alert("❌ 儲存失敗：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAlertDays() {
    setMsg("");
    if (!productId) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "products", productId), {
        expiryAlertDays: Number(alertDays || 7),
        updatedAt: serverTimestamp(),
      });
      setMsg("✅ 已更新提醒天數");
      await loadProducts();
    } finally {
      setBusy(false);
    }
  }

  async function addBatch() {
    setMsg("");
    if (!productId) return setMsg("請先選擇商品");
    if (!expiryDate) return setMsg("請選擇到期日");
    if (Number(qty) <= 0) return setMsg("數量需 > 0");

    setBusy(true);
    try {
      await ensureInventoryDoc(productId);
      await addDoc(collection(db, "inventory", productId, "batches"), {
        qty: Number(qty),
        expiryAt: toTs(expiryDate),
        receivedAt: serverTimestamp(),
      });
      setMsg("✅ 已新增批次");
      setQty(1);
      await loadBatches(productId);
    } finally {
      setBusy(false);
    }
  }

  // ✅ B：掃描所有商品批次 → 產生 notifications（避免重複）
  async function scanAndCreateNotifications() {
    setScanMsg("");
    setScanBusy(true);

    try {
      let plist = products;
      if (!plist || plist.length === 0) {
        const snap = await getDocs(
          query(collection(db, "products"), orderBy("name", "asc"))
        );
        plist = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setProducts(plist);
      }

      let created = 0;
      let updated = 0;
      let skipped = 0;

      for (const p of plist) {
        const pid = p.id;
        const pname = p.name || pid;
        const pAlert = Number(p.expiryAlertDays || 7);

        const bSnap = await getDocs(
          query(
            collection(db, "inventory", pid, "batches"),
            orderBy("expiryAt", "asc")
          )
        );

        for (const b of bSnap.docs) {
          const batchId = b.id;
          const data = b.data();
          const q = Number(data.qty || 0);
          const exp = data.expiryAt?.toDate ? data.expiryAt.toDate() : null;

          if (!exp || q <= 0) {
            skipped++;
            continue;
          }

          const info = getLevel(exp, pAlert);
          if (info.level !== "near" && info.level !== "expired") {
            skipped++;
            continue;
          }

          const nid = `expiry_${pid}_${batchId}`;
          const nRef = doc(db, "notifications", nid);

          const exist = await getDoc(nRef);
          if (exist.exists()) {
            const old = exist.data();
            const keepRead = Boolean(old.read);

            const oldLevel = old.level;
            const oldExp = old.expiryAt?.toDate ? old.expiryAt.toDate() : null;
            const expChanged = oldExp ? oldExp.getTime() !== exp.getTime() : true;

            if (oldLevel !== info.level || expChanged) {
              await setDoc(
                nRef,
                {
                  type: "expiry",
                  level: info.level,
                  productId: pid,
                  productName: pname,
                  batchId,
                  qty: q,
                  expiryAt: data.expiryAt,
                  leftDays: info.left,
                  updatedAt: serverTimestamp(),
                  read: keepRead,
                },
                { merge: true }
              );
              updated++;
            } else {
              skipped++;
            }
          } else {
            await setDoc(nRef, {
              type: "expiry",
              level: info.level,
              productId: pid,
              productName: pname,
              batchId,
              qty: q,
              expiryAt: data.expiryAt,
              leftDays: info.left,
              createdAt: serverTimestamp(),
              read: false,
            });
            created++;
          }
        }
      }

      setScanMsg(`✅ 掃描完成：新增 ${created}、更新 ${updated}、略過 ${skipped}`);
    } catch (e) {
      console.error(e);
      setScanMsg("❌ 掃描失敗：請看 Console 錯誤訊息");
    } finally {
      setScanBusy(false);
    }
  }

  // 初始化：載商品
  useEffect(() => {
    loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 選到商品：載提醒天數 + 批次
  useEffect(() => {
    if (!productId) return;
    loadProductAlertDays(productId);
    loadBatches(productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // 統計
  const stats = useMemo(() => {
    let totalQty = 0;
    let nearQty = 0;
    let expiredQty = 0;

    for (const b of batches) {
      const exp = b.expiryAt?.toDate ? b.expiryAt.toDate() : null;
      const q = Number(b.qty || 0);
      totalQty += q;
      if (!exp) continue;
      const { level } = getLevel(exp, Number(alertDays || 7));
      if (level === "near") nearQty += q;
      if (level === "expired") expiredQty += q;
    }
    return { totalQty, nearQty, expiredQty };
  }, [batches, alertDays]);

  return (
    <>
      <Topbar title="庫存 / 批次管理" />

      {/* 🔔 到期通知掃描（B） */}
      <Card
        title="到期通知（產生通知中心資料）"
        className="span-12 card"
        style={{ marginBottom: 12 }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={scanAndCreateNotifications} disabled={scanBusy}>
            {scanBusy ? "掃描中…" : "🔔 掃描並產生通知"}
          </button>

          <a href="#/notifications" style={{ textDecoration: "none", fontWeight: 700 }}>
            前往通知中心 →
          </a>

          <div style={{ color: "#0ea567" }}>{scanMsg}</div>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
          規則：只針對「有到期日」且「qty &gt; 0」的批次；
          距離到期 ≤ 商品的 expiryAlertDays → 🟡快過期；
          到期日 &lt; 今天 → 🔴已過期。
        </div>
      </Card>

      {/* 商品選擇 */}
      <Card title="商品" className="span-12 card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            選擇商品：
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              style={{ marginLeft: 8, minWidth: 240 }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>

          <div style={{ opacity: 0.75 }}>
            商品ID：<b>{productId || "-"}</b>
          </div>

          <div style={{ marginLeft: "auto", opacity: 0.75 }}>
            總庫存：<b>{stats.totalQty}</b>　
            🟡快過期：<b>{stats.nearQty}</b>　
            🔴已過期：<b>{stats.expiredQty}</b>
          </div>
        </div>
      </Card>

      {/* ✅ 商品資料編輯（加回來） */}
      <Card title="商品資料編輯" className="span-12 card" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <label>
            商品名稱：
            <input
              value={pForm.name}
              onChange={(e) => setPForm((s) => ({ ...s, name: e.target.value }))}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            價格：
            <input
              type="number"
              value={pForm.price}
              onChange={(e) => setPForm((s) => ({ ...s, price: e.target.value }))}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            SKU：
            <input
              value={pForm.sku}
              onChange={(e) => setPForm((s) => ({ ...s, sku: e.target.value }))}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            條碼 barcode：
            <input
              value={pForm.barcode}
              onChange={(e) => setPForm((s) => ({ ...s, barcode: e.target.value }))}
              style={{ width: "100%" }}
            />
          </label>

          <label>
            備用庫存 stock（POS 會用）：
            <input
              type="number"
              value={pForm.stock}
              onChange={(e) => setPForm((s) => ({ ...s, stock: e.target.value }))}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center" }}>
          <button onClick={saveProductEdit} disabled={busy || !productId}>
            {busy ? "儲存中…" : "儲存商品資料"}
          </button>
          <div style={{ color: "#0ea567" }}>{msg}</div>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
          提醒：你現在同時有「批次庫存」與「stock」。如果要讓 POS 完全改成批次扣庫存（FIFO），POS 的庫存檢查也要一起改。
        </div>
      </Card>

      {/* 到期提醒設定 */}
      <Card title="到期提醒設定" className="span-12 card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            提前幾天提醒（expiryAlertDays）：
            <input
              type="number"
              min={1}
              value={alertDays}
              onChange={(e) => setAlertDays(e.target.value)}
              style={{ marginLeft: 8, width: 80 }}
            />
          </label>

          <button onClick={saveAlertDays} disabled={busy || !productId}>
            {busy ? "儲存中…" : "儲存設定"}
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
          規則：到期日 &lt; 今天 = 🔴已過期；距離到期 ≤ {Number(alertDays || 7)} 天 = 🟡快過期；其餘 = 🟢正常
        </div>
      </Card>

      {/* 新增批次 */}
      <Card title="新增進貨批次" className="span-12 card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
          <label>
            數量：
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              style={{ marginLeft: 8, width: 100 }}
            />
          </label>

          <label>
            到期日：
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              style={{ marginLeft: 8 }}
            />
          </label>

          <button onClick={addBatch} disabled={busy || !productId}>
            {busy ? "新增中…" : "新增批次"}
          </button>
        </div>
      </Card>

      {/* 批次列表 */}
      <Card title="批次列表（依到期日排序）" className="span-12 card">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "#64748b", fontSize: 13 }}>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  批次
                </th>
                <th align="right" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  數量
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  到期日
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  狀態
                </th>
                <th align="left" style={{ padding: "8px 4px", borderBottom: "1px solid #e5e7eb" }}>
                  剩餘天數
                </th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const exp = b.expiryAt?.toDate ? b.expiryAt.toDate() : null;
                const info = exp
                  ? getLevel(exp, Number(alertDays || 7))
                  : { text: "⚪ 未設定", left: "-", level: "unknown" };

                return (
                  <tr key={b.id} style={{ opacity: info.level === "expired" ? 0.75 : 1 }}>
                    <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {b.id.slice(0, 8)}…
                    </td>
                    <td align="right" style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {Number(b.qty || 0)}
                    </td>
                    <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {exp ? exp.toLocaleDateString() : "-"}
                    </td>
                    <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {info.text}
                    </td>
                    <td style={{ padding: "10px 4px", borderBottom: "1px solid #f1f5f9" }}>
                      {typeof info.left === "number" ? `${info.left} 天` : info.left}
                    </td>
                  </tr>
                );
              })}

              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: "12px 4px", opacity: 0.6 }}>
                    尚無批次資料。你可以先新增一筆批次（數量＋到期日）。
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
