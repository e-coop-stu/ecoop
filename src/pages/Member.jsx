// src/pages/Member.jsx
import React, { useEffect, useState } from "react";
import Topbar from "../components/Topbar";
import Card from "../components/Card";
import {
  collection,
  getDocs,
  runTransaction,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../lib/firebase";

export default function Member() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amounts, setAmounts] = useState({}); // 每個學生輸入的加值金額

  // 讀取全部學生資料（從 Firestore 的 students 集合）
  async function fetchMembers() {
    setLoading(true);
    setError("");
    try {
      // 🔹 這裡改成 students
      const snap = await getDocs(collection(db, "students"));
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
      // 依 email 排序（你可以改成依 createdAt 排）
      list.sort((a, b) => (a.email || "").localeCompare(b.email || ""));
      setMembers(list);
    } catch (err) {
      console.error(err);
      setError("讀取學生資料失敗：" + err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMembers();
  }, []);

  // 處理單一學生的輸入金額
  function handleAmountChange(memberId, value) {
    setAmounts((prev) => ({
      ...prev,
      [memberId]: value,
    }));
  }

  // 管理員按「加值」的行為
  async function handleTopup(member) {
    const raw = amounts[member.id];

    if (!raw) {
      alert("請先輸入金額");
      return;
    }

    const value = Number(raw);
    if (Number.isNaN(value) || value <= 0) {
      alert("請輸入大於 0 的數字");
      return;
    }

    if (!window.confirm(`確定要幫 ${member.email} 加值 $${value} 嗎？`)) return;

    try {
      setError("");

      await runTransaction(db, async (tx) => {
        // 🔹 這裡也改成 students
        const memberRef = doc(db, "students", member.id);
        const snap = await tx.get(memberRef);

        if (!snap.exists()) {
          throw new Error("找不到該學生帳號");
        }

        const current = snap.data().balance || 0;
        const newBalance = current + value;

        // 1. 更新 students.balance
        tx.update(memberRef, {
          balance: newBalance,
          updatedAt: serverTimestamp(),
        });

        // 2. 新增一筆加值紀錄（topups 集合）
        const topupRef = doc(collection(db, "topups"));
        tx.set(topupRef, {
          // 🔹 欄位名稱順便改成 studentId，之後比較清楚
          studentId: member.id,
          email: member.email || "",
          amount: value,
          createdAt: serverTimestamp(),
          by: "admin", // 之後可以放現在登入的管理員 email
          type: "topup",
        });
      });

      alert("加值成功！");
      // 清空這個學生的輸入框
      setAmounts((prev) => ({ ...prev, [member.id]: "" }));
      // 重新載入最新餘額
      fetchMembers();
    } catch (err) {
      console.error(err);
      const msg = "加值失敗：" + err.message;
      setError(msg);
      alert(msg);
    }
  }

  return (
    <div className="page members-page">
      <Topbar title="學生帳戶 / 加值管理" />

      <div className="page-body">
        <Card>
          <h2>學生清單</h2>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          {loading ? (
            <p>讀取中…</p>
          ) : members.length === 0 ? (
            <p>目前沒有學生資料。</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>email</th>
                  <th>餘額</th>
                  <th style={{ width: 180 }}>加值金額</th>
                  <th style={{ width: 120 }}>動作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.email || m.id}</td>
                    <td>${m.balance ?? 0}</td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        className="input"
                        placeholder="金額"
                        value={amounts[m.id] ?? ""}
                        onChange={(e) =>
                          handleAmountChange(m.id, e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="btn btn-primary"
                        onClick={() => handleTopup(m)}
                      >
                        加值
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
