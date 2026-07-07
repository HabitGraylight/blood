import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const minimaxKey = env.MINIMAX_API_KEY || env.ANTHROPIC_API_KEY || env.VITE_MINIMAX_API_KEY || "";
  const minimaxBase = env.MINIMAX_BASE_URL || env.ANTHROPIC_BASE_URL || "https://api.minimaxi.com/anthropic";

  return {
    plugins: [react()],
    define: {
      __LLM_CONFIGURED__: JSON.stringify(Boolean(minimaxKey))
    },
    server: {
      port: 5173,
      proxy: {
        "/api/minimax": {
          target: minimaxBase,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/minimax/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (minimaxKey) proxyReq.setHeader("x-api-key", minimaxKey);
              proxyReq.setHeader("anthropic-version", "2023-06-01");
            });
          }
        }
      }
    },
    test: {
      environment: "node",
      include: ["test/**/*.test.js"]
    }
  };
});
