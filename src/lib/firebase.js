// src/lib/firebase.js
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore"; // ← 換成 initializeFirestore
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyCA3JFCqMW_CwpdkWRE_kv8XrYKDlQhU08",
  authDomain: "shop-f387d.firebaseapp.com",
  projectId: "shop-f387d",
  storageBucket: "shop-f387d.firebasestorage.app",
  messagingSenderId: "484766516898",
  appId: "1:484766516898:web:8a82461a7d4dee6841b9fb",
  measurementId: "G-S94H7MR8G0"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// 關鍵：強制 Firestore 改用 long-polling，避免 WebChannel 被公司網路/代理擋
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
});

export const auth = getAuth(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);

let analytics = null;
if (firebaseConfig.measurementId) {
  isSupported().then(ok => { if (ok) analytics = getAnalytics(app); });
}

export const googleProvider = new GoogleAuthProvider();

// （可選）本機除錯：在開發模式把專案資訊印出
if (typeof window !== "undefined" && import.meta.env.DEV) {
  console.log("[FB] project:", firebaseConfig.projectId, "bucket:", firebaseConfig.storageBucket);
}
