import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const basePath = String(env.VITE_APP_BASE_PATH || "").trim();
  return {
    appType: "spa",
    base: basePath ? `${basePath.replace(/\/+$/, "")}/` : "/",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5501,
      strictPort: true,
    },
  };
});
