// src/pages/POS.jsx
import React, { useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import BarcodeScanner from "../components/BarcodeScanner"; // 你已有的元件
import { db } from "../lib/firebase";

import {
  collection, query, where, limit, getDocs, addDoc,
  serverTimestamp, doc, getDoc, runTransaction
} from "firebase/firestore";

/** 交易式調整庫存：入庫=正數、出庫=負數（避免負庫存/競態） */
async function adjustStock(productId, delta, opts = {}) {
  const { reason = "sale", note = "", txId = "" } = opts;
  await runTransaction(db, async (tx) => {
    const pRef = doc(db, "products", productId);
    const snap = await tx.get(pRef);
    if (!snap.exists()) throw new Error("Product not found");
    const current = Number(snap.data().stock || 0);
    const next = Math.max(0, current + Number(delta));
    tx.update(pRef, { stock: next });

    // 若要記錄庫存異動，解開以下程式（可之後再開）
    // const mRef = doc(collection(db, "stockMoves"));
    // tx.set(mRef, {
    //   productId, qtyChange:Number(delta), reason, note, txId,
    //   stockAfter: next, ts: serverTimestamp(),
    // });
  });
}

/** 依條碼或 SKU 找商品（先比對 barcode，再比對 sku） */
async function findProductByCode(code) {
  const v = String(code || "").trim();
  if (!v) return null;

  // barcode
  const byBarcode = await getDocs(
    query(collection(db, "products"), where("barcode", "==", v), limit(1))
  );
  if (!byBarcode.empty) {
    const d = byBarcode.docs[0];
    return { id: d.id, ...d.data() };
  }

  // sku
  const bySku = await getDocs(
    query(collection(db, "products"), where("sku", "==", v), limit(1))
  );
  if (!bySku.empty) {
    const d = bySku.docs[0];
    return { id: d.id, ...d.data() };
  }

  return null;
}

export default function POS() {
  const [code, setCode] = useState("");
  const [cart, setCart] = useState([]); // [{productId,name,price,qty}]
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const total = useMemo(
    () => cart.reduce((s, it) => s + Number(it.price||0) * Number(it.qty||0), 0),
    [cart]
  );

  const addByCode = async (c) => {
    const v = (c ?? code).trim();
    if (!v || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const p = await findProductByCode(v);
      if (!p) { setMsg("找不到商品"); return; }

      setCart((prev) => {
        const i = prev.findIndex(x => x.productId === p.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], qty: next[i].qty + 1 };
          return next;
        }
        return [...prev, {
          productId: p.id,
          name: p.name || v,
          price: Number(p.price || 0),
          qty: 1
        }];
      });
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const inc = (id) =>
    setCart((prev) => prev.map(x => x.productId === id ? { ...x, qty: x.qty + 1 } : x));
  const dec = (id) =>
    setCart((prev) =>
      prev.map(x => x.productId === id ? { ...x, qty: Math.max(0, x.qty - 1) } : x)
          .filter(x => x.qty > 0)
    );
  const remove = (id) => setCart(prev => prev.filter(x => x.productId !== id));
  const clear  = () => setCart([]);

  /** 結帳：先檢查庫存，再建立交易，最後逐品項扣庫存 */
  const checkout = async (method = "Face Pay") => {
    if (cart.length === 0 || busy) return;
    setBusy(true); setMsg("");
    try {
      // 1) 檢查庫存是否足夠
      for (const it of cart) {
        const snap = await getDoc(doc(db, "products", it.productId));
        if (!snap.exists()) throw new Error(`找不到商品：${it.productId}`);
        const stock = Number(snap.data().stock || 0);
        if (stock < it.qty) {
          throw new Error(`${snap.data().name || it.productId} 庫存不足（現有 ${stock}，需求 ${it.qty}）`);
        }
      }

      // 2) 寫交易
      const txRef = await addDoc(collection(db, "transactions"), {
        ts: serverTimestamp(),
        total: Number(total),
        method, // "Face Pay" / "現金" / "RFID/卡片"...
        items: cart.map(it => ({
          productId: it.productId,
          name: it.name,
          price: Number(it.price),
          qty: Number(it.qty),
        })),
      });

      // 3) 扣庫存（每一品項都扣）
      for (const it of cart) {
        await adjustStock(it.productId, -it.qty, { reason: "sale", txId: txRef.id, note: "POS" });
      }

      setMsg("✅ 交易完成！");
      setCart([]);
    } catch (e) {
      alert(e?.message || e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Topbar title="POS 收銀" right={<a className="badge" href="#/inventory">商品／庫存</a>} />
      <div className="dashboard-grid cols-12" style={{ gap: 16 }}>
        {/* 左：輸入代碼 / 條碼掃描 */}
        <Card title="掃條碼 / 輸入代碼" className="span-6">
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="輸入商品代碼（條碼或 SKU）"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addByCode()}
            />
            <button onClick={() => addByCode()} disabled={busy}>加入</button>
          </div>

          <BarcodeScanner
            onScan={(text) => addByCode(text)}
            style={{ padding: 12, background: "#eef2f7", borderRadius: 8 }}
          />
          {msg && <div style={{ marginTop: 8, color: "#0ea567" }}>{msg}</div>}
        </Card>

        {/* 右：購物車 */}
        <Card title="購物車" className="span-6">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>品名</th>
                  <th style={{ textAlign: "center", padding: 8 }}>數量</th>
                  <th style={{ textAlign: "right", padding: 8 }}>單價</th>
                  <th style={{ textAlign: "right", padding: 8 }}>小計</th>
                  <th style={{ textAlign: "center", padding: 8, width: 180 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {cart.map(it => (
                  <tr key={it.productId} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{it.name}</td>
                    <td style={{ padding: 8, textAlign: "center" }}>{it.qty}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>${Number(it.price).toLocaleString()}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      ${(Number(it.price) * Number(it.qty)).toLocaleString()}
                    </td>
                    <td style={{ padding: 8, textAlign: "center" }}>
                      <button onClick={() => inc(it.productId)}>+1</button>{" "}
                      <button onClick={() => dec(it.productId)}>-1</button>{" "}
                      <button onClick={() => remove(it.productId)} style={{ color:"#b00" }}>移除</button>
                    </td>
                  </tr>
                ))}
                {cart.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, color: "#999" }}>尚未加入商品</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={clear} disabled={cart.length === 0 || busy}>清空</button>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>合計：${total.toLocaleString()}</div>
              <button
                onClick={() => checkout("Face Pay")}
                disabled={cart.length === 0 || busy}
                style={{ background:"#16a34a", color:"#fff", border:0, padding:"8px 12px", borderRadius: 8 }}
              >
                Face Pay 付款（之後接）
              </button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
