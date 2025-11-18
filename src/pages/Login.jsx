// src/pages/Login.jsx
import React, { useState } from "react";
import { auth } from "../lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";

const theme = {
  primary: "#0ea567",
  border: "#e5e7eb",
  text: "#0f172a",
  subtext: "#64748b",
  radius: 16,
};

export default function Login() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email.trim(), pw);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), pw);
      }
      window.location.hash = "#/"; // 登入成功導回首頁
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setBusy(true); setErr("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      window.location.hash = "#/";
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      background: "#f3f5f8",
      padding: 16
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: "#fff",
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius,
        padding: 24
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12, display:"grid", placeItems:"center",
            background: theme.primary, color:"#fff", fontWeight:800
          }}>C</div>
          <div style={{ fontWeight:800, fontSize: 18 }}>Coop Admin</div>
        </div>

        <h2 style={{ margin:"0 0 8px 0" }}>{mode === "signin" ? "登入" : "建立帳號"}</h2>
        <p style={{ color: theme.subtext, marginTop: 0, marginBottom: 16 }}>
          {mode === "signin" ? "使用帳號密碼登入系統" : "註冊新帳號後自動登入"}
        </p>

        <form onSubmit={handleSubmit} style={{ display:"grid", gap:12 }}>
          <label style={{ display:"grid", gap:6 }}>
            <span>電子郵件</span>
            <input
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              required
              style={{ padding:"10px 12px", border:`1px solid ${theme.border}`, borderRadius:10 }}
            />
          </label>

          <label style={{ display:"grid", gap:6 }}>
            <span>密碼</span>
            <input
              type="password"
              value={pw}
              onChange={(e)=>setPw(e.target.value)}
              required
              style={{ padding:"10px 12px", border:`1px solid ${theme.border}`, borderRadius:10 }}
            />
          </label>

          {err && <div style={{ color:"#b91c1c", fontSize:13 }}>{err}</div>}

          <button
            type="submit"
            disabled={busy}
            style={{
              background: theme.primary, color:"#fff", border:0,
              padding:"10px 12px", borderRadius:10, fontWeight:700
            }}
          >
            {busy ? "處理中…" : (mode === "signin" ? "登入" : "建立並登入")}
          </button>
        </form>

        <div style={{ display:"grid", gap:10, marginTop:12 }}>
          <button
            onClick={signInWithGoogle}
            disabled={busy}
            style={{
              background:"#fff", color: theme.text, border:`1px solid ${theme.border}`,
              padding:"10px 12px", borderRadius:10, fontWeight:700
            }}
          >
            使用 Google 登入
          </button>

          <div style={{ fontSize:13, color: theme.subtext, textAlign:"center" }}>
            {mode === "signin" ? (
              <>沒有帳號？ <a href="#" onClick={(e)=>{e.preventDefault(); setMode("signup");}}>建立一個</a></>
            ) : (
              <>已經有帳號？ <a href="#" onClick={(e)=>{e.preventDefault(); setMode("signin");}}>改為登入</a></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
