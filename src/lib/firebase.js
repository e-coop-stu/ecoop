// src/lib/firebase.js
import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore"; // ← 換成 initializeFirestore
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FB_DATABASE_URL || undefined,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE, // 必須是 *.appspot.com
  messagingSenderId: import.meta.env.VITE_FB_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
  measurementId: import.meta.env.VITE_FB_MEASUREMENT_ID || undefined,
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
