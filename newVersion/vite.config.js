import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const minimaxKey = env.MINIMAX_API_KEY || env.ANTHROPIC_API_KEY || env.VITE_MINIMAX_API_KEY || "";
  const minimaxBase = env.MINIMAX_BASE_URL || env.ANTHROPIC_BASE_URL || "https://api.minimaxi.com/anthropic";

  return {
    plugins: [react()],
    define: {
      // 本地有 key(开发代理注入)或显式指向已部署的生产代理(如 Cloudflare Worker)都视为已配置
      __LLM_CONFIGURED__: JSON.stringify(Boolean(minimaxKey) || Boolean(env.VITE_MINIMAX_ENDPOINT))
    },
    server: {
      port: Number(process.env.PORT) || 5173,
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
