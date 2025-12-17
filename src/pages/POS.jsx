// src/pages/POS.jsx
import React, { useMemo, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import BarcodeScanner from "../components/BarcodeScanner";
import { db } from "../lib/firebase";

import {
  collection,
  query,
  where,
  limit,
  getDocs,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
} from "firebase/firestore";

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

/** 把 order.items 轉成 POS 顯示用的 cart 形狀 */
function normalizeOrderItems(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.map((it) => {
    const productId = it.productId || it.id || it.sku; // 兼容不同資料
    const sku = it.sku || it.productId || it.id || productId;
    const price = Number(it.price || 0);
    const qty = Number(it.qty || 0);
    // 兼容 subtotal / lineTotal
    const subtotal =
      it.subtotal != null ? Number(it.subtotal) : Number(it.lineTotal || price * qty);

    return {
      productId,
      sku,
      name: it.name || "未命名商品",
      price,
      qty,
      subtotal,
    };
  });
}

export default function POS() {
  const [code, setCode] = useState("");
  const [cart, setCart] = useState([]); // [{productId, sku, name, price, qty}]
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lastReqId, setLastReqId] = useState("");

  // ✅ 新增：pickupCode 訂單
  const [pickupCode, setPickupCode] = useState("");
  const [order, setOrder] = useState(null);
  const [orderErr, setOrderErr] = useState("");
  const [loadingOrder, setLoadingOrder] = useState(false);

  // 如果載入了訂單，就用訂單內容顯示；否則用原本購物車
  const cartToShow = useMemo(() => {
    if (!order) return cart;
    return normalizeOrderItems(order);
  }, [order, cart]);

  const totalToShow = useMemo(() => {
    if (order) return Number(order.total || 0);
    return cart.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0);
  }, [order, cart]);

  const isShowingOrder = !!order;

  const addByCode = async (c) => {
    // 如果正在看訂單，就不要讓它混到購物車（避免學生亂加）
    if (isShowingOrder) {
      setMsg("目前已載入訂單，請先「清除訂單」才可新增商品");
      return;
    }

    const v = String(c ?? code).trim();
    if (!v || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const p = await findProductByCode(v);
      if (!p) {
        setMsg("找不到商品");
        return;
      }

      setCart((prev) => {
        const i = prev.findIndex((x) => x.productId === p.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { ...next[i], qty: next[i].qty + 1 };
          return next;
        }
        return [
          ...prev,
          {
            productId: p.id,
            sku: p.sku || p.id,
            name: p.name || v,
            price: Number(p.price || 0),
            qty: 1,
          },
        ];
      });

      setCode("");
    } finally {
      setBusy(false);
    }
  };

  const inc = (id) =>
    setCart((prev) =>
      prev.map((x) => (x.productId === id ? { ...x, qty: x.qty + 1 } : x))
    );

  const dec = (id) =>
    setCart((prev) =>
      prev
        .map((x) => (x.productId === id ? { ...x, qty: Math.max(0, x.qty - 1) } : x))
        .filter((x) => x.qty > 0)
    );

  const remove = (id) => setCart((prev) => prev.filter((x) => x.productId !== id));
  const clear = () => setCart([]);

  /** ✅ 依 pickupCode 載入訂單（orders） */
  const loadOrderByPickupCode = async () => {
    const code = String(pickupCode || "").trim().toUpperCase();
    if (!code || loadingOrder) return;

    setLoadingOrder(true);
    setOrderErr("");
    setMsg("");

    try {
      const q = query(
        collection(db, "orders"),
        where("pickupCode", "==", code),
        limit(1)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setOrder(null);
        setOrderErr("找不到此 pickupCode 的訂單");
        return;
      }

      const d = snap.docs[0];
      const data = { id: d.id, ...d.data() };

      if (!Array.isArray(data.items) || data.items.length === 0) {
        setOrder(null);
        setOrderErr("此訂單沒有商品內容");
        return;
      }

      setOrder(data);
      setMsg(`✅ 已載入訂單（pickupCode：${code}）`);
    } catch (e) {
      console.error(e);
      setOrder(null);
      setOrderErr("讀取訂單失敗，請稍後再試");
    } finally {
      setLoadingOrder(false);
    }
  };

  const clearOrder = () => {
    setOrder(null);
    setPickupCode("");
    setOrderErr("");
    setMsg("已清除訂單，回到購物車模式");
  };

  /** ✅ Face Pay：建立 checkout_requests（who=null）觸發樹莓派 */
  const createCheckoutRequest = async () => {
    const activeItems = cartToShow;
    const activeTotal = totalToShow;

    if (activeItems.length === 0 || busy) return;

    setBusy(true);
    setMsg("");
    setLastReqId("");

    try {
      // 1) 先檢查庫存是否足夠（用 products.stock）
      for (const it of activeItems) {
        if (!it.productId) throw new Error("商品資料缺少 productId");
        const snap = await getDoc(doc(db, "products", it.productId));
        if (!snap.exists()) throw new Error(`找不到商品：${it.productId}`);
        const stock = Number(snap.data().stock || 0);
        if (stock < it.qty) {
          throw new Error(
            `${snap.data().name || it.productId} 庫存不足（現有 ${stock}，需求 ${it.qty}）`
          );
        }
      }

      // 2) 建立待付款單（who=null → 樹莓派看到就開始偵測）
      const items = activeItems.map((it) => ({
        productId: it.productId,
        sku: it.sku || it.productId,
        name: it.name || "",
        qty: Number(it.qty || 0),
        price: Number(it.price || 0),
        lineTotal:
          it.subtotal != null
            ? Number(it.subtotal)
            : Number(it.qty || 0) * Number(it.price || 0),
      }));

      const payload = {
        status: "pending",
        method: "Face Pay",
        total: Number(activeTotal),
        items,
        who: null,
        createdAt: serverTimestamp(),
        source: "pos_web",

        // ✅ 如果目前是「訂單模式」，把訂單資訊也帶過去（對帳很好用）
        fromOrder: isShowingOrder ? true : false,
        orderId: isShowingOrder ? order.id : null,
        pickupCode: isShowingOrder ? order.pickupCode || pickupCode.trim() : null,
      };

      const reqRef = await addDoc(collection(db, "checkout_requests"), payload);

      setLastReqId(reqRef.id);
      setMsg("✅ 已送出 Face Pay 請求，請看鏡頭進行辨識");

      // 付款送出後：訂單模式就保留畫面（你也可以改成清掉）
      if (!isShowingOrder) setCart([]);
    } catch (e) {
      console.error(e);
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
          {/* ✅ 新增：pickupCode */}
          <div style={{ marginBottom: 12, padding: 12, border: "1px solid #e5e7eb", borderRadius: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>
              輸入 PickupCode 讀取訂單
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder="輸入取貨碼（例如 776UWQ）"
                value={pickupCode}
                onChange={(e) => setPickupCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadOrderByPickupCode()}
                style={{ minWidth: 240 }}
              />
              <button onClick={loadOrderByPickupCode} disabled={loadingOrder || busy}>
                {loadingOrder ? "讀取中…" : "載入訂單"}
              </button>
              <button onClick={clearOrder} disabled={!order || busy}>
                清除訂單
              </button>
            </div>

            {orderErr && <div style={{ marginTop: 8, color: "#b00020" }}>{orderErr}</div>}

            {order && (
              <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
                已載入訂單：<b>{order.id}</b>｜狀態：<b>{order.status}</b>｜總計：<b>${Number(order.total || 0).toLocaleString()}</b>
              </div>
            )}
          </div>

          {/* 原本：商品代碼輸入 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              placeholder="輸入商品代碼（條碼或 SKU）"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addByCode()}
              disabled={isShowingOrder}
            />
            <button onClick={() => addByCode()} disabled={busy || isShowingOrder}>加入</button>
          </div>

          <BarcodeScanner
            onScan={(text) => addByCode(text)}
            style={{ padding: 12, background: "#eef2f7", borderRadius: 8, opacity: isShowingOrder ? 0.5 : 1 }}
          />

          {msg && <div style={{ marginTop: 8, color: "#0ea567" }}>{msg}</div>}

          {lastReqId && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
              本次請求ID：<b>{lastReqId}</b>（樹莓派可用這筆做扣款）
            </div>
          )}
        </Card>

        {/* 右：購物車（或訂單內容） */}
        <Card title={isShowingOrder ? "訂單內容" : "購物車"} className="span-6">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>品名</th>
                  <th style={{ textAlign: "center", padding: 8 }}>數量</th>
                  <th style={{ textAlign: "right", padding: 8 }}>單價</th>
                  <th style={{ textAlign: "right", padding: 8 }}>小計</th>
                  <th style={{ textAlign: "center", padding: 8, width: 200 }}>
                    {isShowingOrder ? "狀態" : "操作"}
                  </th>
                </tr>
              </thead>

              <tbody>
                {cartToShow.map((it) => (
                  <tr key={it.productId || it.sku} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>
                      {it.name}
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        SKU：{it.sku || it.productId}
                      </div>
                    </td>
                    <td style={{ padding: 8, textAlign: "center" }}>{it.qty}</td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      ${Number(it.price).toLocaleString()}
                    </td>
                    <td style={{ padding: 8, textAlign: "right" }}>
                      ${Number(it.subtotal ?? (Number(it.price) * Number(it.qty))).toLocaleString()}
                    </td>

                    <td style={{ padding: 8, textAlign: "center" }}>
                      {isShowingOrder ? (
                        <span style={{ color: "#64748b" }}>依訂單</span>
                      ) : (
                        <>
                          <button onClick={() => inc(it.productId)} disabled={busy}>+1</button>{" "}
                          <button onClick={() => dec(it.productId)} disabled={busy}>-1</button>{" "}
                          <button
                            onClick={() => remove(it.productId)}
                            disabled={busy}
                            style={{ color: "#b00" }}
                          >
                            移除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}

                {cartToShow.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 12, color: "#999" }}>
                      {isShowingOrder ? "尚未載入訂單 / 或訂單沒有商品" : "尚未加入商品"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
            <button onClick={clear} disabled={isShowingOrder || cart.length === 0 || busy}>
              清空
            </button>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>合計：${Number(totalToShow).toLocaleString()}</div>

              <button
                onClick={createCheckoutRequest}
                disabled={cartToShow.length === 0 || busy}
                style={{
                  background: "#16a34a",
                  color: "#fff",
                  border: 0,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontWeight: 700,
                }}
              >
                Face Pay 付款（送出請求）
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: "#64748b" }}>
            流程：POS 送出 checkout_requests（who=null）→ 樹莓派辨識後寫入 who(uid) → 之後由樹莓派/後端扣 students/{`{uid}`}.balance。
          </div>
        </Card>
      </div>
    </>
  );
}
