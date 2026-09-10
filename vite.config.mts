import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // スマホ実機から LAN 経由で開けるようにする
    host: true,
    proxy: {
      "/socket.io": { target: "http://localhost:3000", ws: true },
      "/qr.png": { target: "http://localhost:3000" },
      // 部屋の作成・参加URL・oEmbed 中継。これが無いと開発時だけ 404 になる
      "/api": { target: "http://localhost:3000" },
    },
  },
});
