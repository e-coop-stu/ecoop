// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./lib/firebase";

import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Inventory from "./pages/Inventory";
import POS from "./pages/POS";
import Login from "./pages/Login";
import Member from "./pages/Member";
import Notifications from "./pages/Notifications";

// Hash routes（支援 #/xxx?q=xxx）
const routes = {
  "": Dashboard,
  "#/": Dashboard,
  "#/dashboard": Dashboard,
  "#/pos": POS,
  "#/reports": Reports,
  "#/tx": Transactions,
  "#/inventory": Inventory,
  "#/member": Member,
  "#/notifications": Notifications,
  "#/login": Login,
};

const theme = {
  primary: "#0ea567",
  sidebarBg: "#ffffff",
  mainBg: "#f3f5f8",
  border: "#e5e7eb",
  text: "#0f172a",
  subtext: "#64748b",
  radius: 16,
  sidebarW: 240,
};

function MenuItem({ to, icon, label, active }) {
  return (
    <a
      href={to}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 12,
        color: active ? theme.primary : "#334155",
        background: active ? "rgba(14,165,104,0.08)" : "transparent",
        fontWeight: active ? 700 : 500,
        textDecoration: "none",
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 10,
          display: "grid",
          placeItems: "center",
          background: active ? "rgba(14,165,104,0.12)" : "#f1f5f9",
          fontSize: 14,
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </a>
  );
}

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: theme.subtext,
        letterSpacing: 1,
        margin: "18px 0 8px 6px",
      }}
    >
      {children}
    </div>
  );
}

// 解析 hash： "#/inventory?q=abc" -> { path:"#/inventory", q:"abc" }
function parseHash(h) {
  const raw = h || "#/";
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs || "");
  return { path: path || "#/", q: params.get("q") || "" };
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  const [user, setUser] = useState(undefined); // undefined=載入中, null=未登入, object=已登入

  // ✅ 搜尋列狀態（商品/訂單 + 關鍵字）
  const [searchType, setSearchType] = useState("inventory"); // inventory | tx
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => {
      unsub();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // ✅ 讓 Page 選擇只看 path（不被 ?q= 影響）
  const { path, q } = useMemo(() => parseHash(hash), [hash]);

  // ✅ 當你跳到 inventory/tx 並帶 q 時，自動把搜尋框同步顯示
  useEffect(() => {
    if (path === "#/inventory") {
      setSearchType("inventory");
      if (q) setSearchText(q);
    }
    if (path === "#/tx") {
      setSearchType("tx");
      if (q) setSearchText(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, q]);

  const isLoginRoute = path === "#/login";
  const Page = useMemo(() => routes[path] || Dashboard, [path]);

  if (user === undefined) return null;

  if (!user) {
    if (!isLoginRoute) window.location.hash = "#/login";
    return <Login />;
  }

  if (isLoginRoute) window.location.hash = "#/";

  const isActive = (h) =>
    path === h || (h === "#/" && (path === "" || path === "#/dashboard"));

  const initial = (user.displayName?.[0] || user.email?.[0] || "U").toUpperCase();

  async function doSignOut() {
    await signOut(auth);
    window.location.hash = "#/login";
  }

  // ✅ 搜尋：按 Enter 或按鈕 → 跳到指定頁並帶 q
  function runSearch() {
    const keyword = String(searchText || "").trim();
    if (!keyword) return;
    window.location.hash = `#/${searchType}?q=${encodeURIComponent(keyword)}`;
  }

  // ✅ 右上四個按鈕（你要的四個）
  const quickBtns = [
    { to: "#/pos", label: "🧾 Checkout", primary: true },
    { to: "#/inventory", label: "📦 Inventory", primary: false },
    { to: "#/reports", label: "📈 Analytics", primary: false },
    { to: "#/notifications", label: "🔔 Notifiction", primary: false },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.mainBg,
        display: "grid",
        gridTemplateColumns: `${theme.sidebarW}px 1fr`,
      }}
    >
      {/* Sidebar */}
      <aside
        style={{
          background: theme.sidebarBg,
          borderRight: `1px solid ${theme.border}`,
          padding: 16,
          position: "sticky",
          top: 0,
          height: "100vh",
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 8px",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: theme.primary,
              color: "#fff",
              fontWeight: 800,
            }}
          >
            C
          </div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Coop Admin</div>
        </div>

        {/* Menu */}
        <SectionTitle>MENU</SectionTitle>
        <div style={{ display: "grid", gap: 6 }}>
          <MenuItem to="#/" icon="🏠" label="Dashboard" active={isActive("#/") || isActive("#/dashboard")} />
          <MenuItem to="#/pos" icon="🧾" label="POS" active={isActive("#/pos")} />
          <MenuItem to="#/reports" icon="📈" label="Analytics" active={isActive("#/reports")} />
          <MenuItem to="#/tx" icon="📜" label="Transactions" active={isActive("#/tx")} />
          <MenuItem to="#/member" icon="💳" label="Members / Deposit" active={isActive("#/member")} />
          <MenuItem to="#/inventory" icon="📦" label="Inventory" active={isActive("#/inventory")} />
          <MenuItem to="#/notifications" icon="🔔" label="Notifications" active={isActive("#/notifications")} />
        </div>

        {/* General */}
        <SectionTitle>GENERAL</SectionTitle>
        <div style={{ display: "grid", gap: 6 }}>
          <a
            onClick={doSignOut}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 12px",
              borderRadius: 12,
              color: "#334155",
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: "#f1f5f9",
              }}
            >
              🚪
            </span>
            <span>Logout</span>
          </a>
        </div>
      </aside>

      {/* Main */}
      <main style={{ padding: 18 }}>
        {/* Top Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          {/* ✅ 搜尋框（商品/訂單） */}
          <div
            style={{
              flex: 1,
              minWidth: 320,
              background: "#fff",
              border: `1px solid ${theme.border}`,
              borderRadius: 12,
              padding: "10px 12px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ color: theme.subtext }}>🔎</span>

            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value)}
              style={{
                border: 0,
                outline: 0,
                background: "transparent",
                color: theme.subtext,
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              <option value="inventory">商品</option>
              <option value="tx">訂單/交易</option>
            </select>

            <input
              placeholder={
                searchType === "inventory"
                  ? "搜尋商品（name / sku / barcode）"
                  : "搜尋訂單（pickupCode / orderId / uid / reqId）"
              }
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              style={{
                border: 0,
                outline: 0,
                width: "100%",
                fontSize: 14,
                background: "transparent",
              }}
            />

            <button
              onClick={runSearch}
              style={{
                border: `1px solid ${theme.border}`,
                background: "#fff",
                borderRadius: 10,
                padding: "8px 12px",
                fontWeight: 900,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              搜尋
            </button>
          </div>

          {/* ✅ 四個快捷按鈕 */}
          {quickBtns.map((b) => (
            <a
              key={b.to}
              href={b.to}
              style={{
                background: b.primary ? theme.primary : "#fff",
                color: b.primary ? "#fff" : theme.text,
                textDecoration: "none",
                padding: "10px 14px",
                borderRadius: 12,
                fontWeight: 800,
                border: b.primary ? "none" : `1px solid ${theme.border}`,
                whiteSpace: "nowrap",
              }}
            >
              {b.label}
            </a>
          ))}

          {/* Avatar */}
          <div
            title={user.email}
            onClick={doSignOut}
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              background: "#fff",
              border: `1px solid ${theme.border}`,
              display: "grid",
              placeItems: "center",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            {initial}
          </div>
        </div>

        {/* Page Surface */}
        <div
          style={{
            background: "#fff",
            border: `1px solid ${theme.border}`,
            borderRadius: theme.radius,
            padding: 14,
          }}
        >
          <Page />
        </div>
      </main>
    </div>
  );
}
