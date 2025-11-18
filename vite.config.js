import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: '/ecoop/',  // ← 你的 GitHub repo 名字（一定要加 /）
});
