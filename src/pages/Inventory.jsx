import React, { useEffect, useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import { db } from "../lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc,
  runTransaction
} from "firebase/firestore";

// 內部用：空白表單
const emptyForm = () => ({
  id: "",
  name: "",
  sku: "",
  barcode: "",
  price: "",
  stock: "",
  safetyStock: "",
});

export default function Inventory() {
  // 狀態
  const [rows, setRows] = useState([]);       // 全部商品
  const [qText, setQText] = useState("");     // 搜尋
  const [form, setForm] = useState(emptyForm());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // 即時讀取 products
  useEffect(() => {
    const q = query(collection(db, "products"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setRows(
        snap.docs.map((d) => {
          const x = { id: d.id, ...d.data() };
          // 後填預設值，避免欄位不存在造成 NaN/undefined 顯示
          x.price = Number(x.price || 0);
          x.stock = Number(x.stock || 0);
          x.safetyStock = Number(x.safetyStock || 0);
          x.name = x.name || "";
          x.sku = x.sku || "";
          x.barcode = x.barcode || "";
          return x;
        })
      );
    });
    return () => unsub();
  }, []);

  // 本地搜尋
  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        r.sku.toLowerCase().includes(t) ||
        r.barcode.toLowerCase().includes(t)
    );
  }, [rows, qText]);

  // 新增/更新
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = {
        name: form.name.trim(),
        sku: (form.sku || "").trim(),
        barcode: (form.barcode || "").trim(),
        price: Number(form.price || 0),
        stock: Number(form.stock || 0),
        safetyStock: Number(form.safetyStock || 0),
      };

      if (editing) {
        await updateDoc(doc(db, "products", form.id), data);
      } else {
        await addDoc(collection(db, "products"), {
          ...data,
          createdAt: serverTimestamp(),
        });
      }
      setForm(emptyForm());
      setEditing(false);
    } catch (e) {
      alert("儲存失敗：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // 編輯
  function editRow(r) {
    setEditing(true);
    setForm({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      price: r.price,
      stock: r.stock,
      safetyStock: r.safetyStock,
    });
  }

  // 刪除
  async function removeRow(id) {
    if (!confirm("確定刪除這個商品？")) return;
    await deleteDoc(doc(db, "products", id));
  }

  // 交易式調整庫存（避免負數/競態）
  async function adjustStock(productId, delta, reason = "manual") {
    try {
      await runTransaction(db, async (tx) => {
        const pRef = doc(db, "products", productId);
        const snap = await tx.get(pRef);
        if (!snap.exists()) throw new Error("Product not found");

        const cur = Number(snap.data().stock || 0);
        const next = Math.max(0, cur + Number(delta)); // 不讓負庫存
        tx.update(pRef, { stock: next });

        // 可選：寫入庫存異動紀錄（若你有 stockMoves 集合就解註）
        // const mRef = doc(collection(db, "stockMoves"));
        // tx.set(mRef, {
        //   productId, qtyChange: Number(delta), reason,
        //   stockAfter: next, ts: serverTimestamp(),
        // });
      });
    } catch (e) {
      alert("調整庫存失敗：" + (e?.message || e));
    }
  }

  return (
    <>
      <Topbar title="商品／庫存" />

      {/* 新增 / 編輯表單 */}
      <Card title={editing ? "編輯商品" : "新增商品"} className="span-12" style={{ marginBottom: 12 }}>
        <form
          onSubmit={save}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr auto",
            gap: 8,
            alignItems: "end",
          }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            名稱
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            SKU
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            條碼
            <input
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            售價
            <input
              type="number"
              min="0"
              step="1"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            庫存
            <input
              type="number"
              step="1"
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              required
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            安全庫存
            <input
              type="number"
              step="1"
              value={form.safetyStock}
              onChange={(e) =>
                setForm({ ...form, safetyStock: e.target.value })
              }
            />
          </label>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" disabled={busy}>
              {editing ? "儲存" : "新增"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setForm(emptyForm());
                  setEditing(false);
                }}
              >
                取消
              </button>
            )}
          </div>
        </form>
      </Card>

      {/* 工具列 */}
      <Card title="商品清單" className="span-12">
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 8,
            flexWrap: "wrap",
          }}
        >
          <input
            placeholder="搜尋 名稱 / SKU / 條碼"
            value={qText}
            onChange={(e) => setQText(e.target.value)}
          />
          <div style={{ marginLeft: "auto", color: "#666" }}>
            共 {filtered.length} 筆
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8 }}>名稱</th>
                <th style={{ textAlign: "left", padding: 8 }}>SKU</th>
                <th style={{ textAlign: "left", padding: 8 }}>條碼</th>
                <th style={{ textAlign: "right", padding: 8 }}>售價</th>
                <th style={{ textAlign: "right", padding: 8 }}>庫存</th>
                <th style={{ textAlign: "right", padding: 8 }}>安全庫存</th>
                <th style={{ textAlign: "center", padding: 8, width: 280 }}>
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 8 }}>{r.name}</td>
                  <td style={{ padding: 8 }}>{r.sku}</td>
                  <td style={{ padding: 8 }}>{r.barcode}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>
                    ${r.price.toLocaleString()}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>
                    {r.stock.toLocaleString()}
                    {r.safetyStock > 0 && r.stock < r.safetyStock && (
                      <span style={{ color: "#b00", marginLeft: 6 }}>⚠ 補貨</span>
                    )}
                  </td>
                  <td style={{ padding: 8, textAlign: "right" }}>
                    {r.safetyStock.toLocaleString()}
                  </td>
                  <td style={{ padding: 8, textAlign: "center" }}>
                    <button onClick={() => editRow(r)}>編輯</button>{" "}
                    <button onClick={() => adjustStock(r.id, +1)}>+1</button>{" "}
                    <button onClick={() => adjustStock(r.id, -1)}>-1</button>{" "}
                    <button
                      onClick={() => {
                        const n = Number(
                          prompt("自訂調整量（入庫正數 / 出庫負數）", "10")
                        );
                        if (Number.isFinite(n)) adjustStock(r.id, n);
                      }}
                    >
                      調整
                    </button>{" "}
                    <button
                      onClick={() => removeRow(r.id)}
                      style={{ color: "#b00" }}
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: "#999" }}>
                    沒有資料
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
