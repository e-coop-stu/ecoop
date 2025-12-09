// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./lib/firebase";

import Dashboard    from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Reports      from "./pages/Reports";
import Inventory    from "./pages/Inventory";
import POS          from "./pages/POS";
import Login        from "./pages/Login";
import Members from "./pages/Members";


// Hash routes
const routes = {
  "": Dashboard,
  "#/": Dashboard,
  "#/dashboard": Dashboard,
  "#/pos": POS,
  "#/reports": Reports,
  "#/tx": Transactions,
  "#/inventory": Inventory,
  "#/login": Login,
  "#/members": Members,
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
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", borderRadius: 12,
        color: active ? theme.primary : "#334155",
        background: active ? "rgba(14,165,104,0.08)" : "transparent",
        fontWeight: active ? 700 : 500
      }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 10,
        display: "grid", placeItems: "center",
        background: active ? "rgba(14,165,104,0.12)" : "#f1f5f9", fontSize: 14
      }}>{icon}</span>
      <span>{label}</span>
    </a>
  );
}
function SectionTitle({ children }) {
  return <div style={{ fontSize: 12, color: theme.subtext, letterSpacing: 1, margin: "18px 0 8px 6px" }}>{children}</div>;
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  const [user, setUser] = useState(undefined); // undefined=載入中, null=未登入, object=已登入

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    const onHash = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => { unsub(); window.removeEventListener("hashchange", onHash); };
  }, []);

  const isLoginRoute = hash === "#/login";
  const Page = useMemo(() => routes[hash] || Dashboard, [hash]);

  // 載入中先不畫
  if (user === undefined) return null;

  // 未登入時只顯示登入頁（不出現側邊欄）
  if (!user) {
    if (!isLoginRoute) window.location.hash = "#/login";
    return <Login />;
  }

  // 已登入仍在 /login → 導回首頁
  if (isLoginRoute) window.location.hash = "#/";

  const isActive = (h) => (hash === h || (h === "#/" && (hash === "" || hash === "#/dashboard")));

  const initial = (user.displayName?.[0] || user.email?.[0] || "U").toUpperCase();

  async function doSignOut() {
    await signOut(auth);
    window.location.hash = "#/login";
  }

  return (
    <div style={{
      minHeight: "100vh", background: theme.mainBg,
      display: "grid", gridTemplateColumns: `${theme.sidebarW}px 1fr`
    }}>
      {/* Sidebar */}
      <aside style={{
        background: theme.sidebarBg, borderRight: `1px solid ${theme.border}`,
        padding: 16, position: "sticky", top: 0, height: "100vh"
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 8px", marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, display:"grid", placeItems:"center",
            background: theme.primary, color:"#fff", fontWeight:800
          }}>C</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Coop Admin</div>
        </div>

        <SectionTitle>MENU</SectionTitle>
        <div style={{ display:"grid", gap: 6 }}>
          <MenuItem to="#/"           icon="🏠" label="Dashboard"    active={isActive("#/") || isActive("#/dashboard")} />
          <MenuItem to="#/pos"        icon="🧾" label="POS"          active={isActive("#/pos")} />
          <MenuItem to="#/reports"    icon="📈" label="Analytics"    active={isActive("#/reports")} />
          <MenuItem to="#/tx"         icon="👥" label="Transactions" active={isActive("#/tx")} />
          <MenuItem to="#/inventory"  icon="📦" label="Inventory"    active={isActive("#/inventory")} />
        </div>

        <SectionTitle>GENERAL</SectionTitle>
        <div style={{ display:"grid", gap: 6 }}>
          
          <a onClick={doSignOut} style={{
            cursor:"pointer", display:"flex", alignItems:"center", gap:12,
            padding:"10px 12px", borderRadius:12, color:"#334155"
          }}>
            <span style={{ width:28, height:28, borderRadius:10, display:"grid", placeItems:"center", background:"#f1f5f9" }}>🚪</span>
            <span>Logout</span>
          </a>
        </div>
      </aside>

      {/* Main */}
      <main style={{ padding: 18 }}>
        {/* Top Header */}
        <div style={{ display:"flex", alignItems:"center", gap: 12, marginBottom: 14 }}>
          {/* Search（暫時樣式） */}
          <div style={{
            flex: 1, background:"#fff", border:`1px solid ${theme.border}`,
            borderRadius: 12, padding: "10px 12px", display:"flex", alignItems:"center", gap:8
          }}>
            <span style={{ color: theme.subtext }}>🔎</span>
            <input placeholder="Search task" style={{ border:0, outline:0, width:"100%", fontSize:14, background:"transparent" }} />
          </div>

          <a href="#/pos" style={{
            background: theme.primary, color:"#fff", textDecoration:"none",
            padding:"10px 14px", borderRadius: 12, fontWeight: 700
          }}>+ Add Project</a>

          <a href="#/inventory" style={{
            background:"#fff", color: theme.text, textDecoration:"none",
            padding:"10px 14px", borderRadius: 12, border:`1px solid ${theme.border}`, fontWeight:700
          }}>Import Data</a>

          {/* Avatar + email（點擊可登出） */}
          <div title={user.email} onClick={doSignOut} style={{
            width: 38, height: 38, borderRadius: 999, background:"#fff",
            border:`1px solid ${theme.border}`, display:"grid", placeItems:"center",
            fontWeight: 800, cursor:"pointer"
          }}>
            {initial}
          </div>
        </div>

        {/* Page Surface */}
        <div style={{
          background:"#fff", border:`1px solid ${theme.border}`,
          borderRadius: theme.radius, padding: 14
        }}>
          <Page />
        </div>
      </main>
    </div>
  );
}
