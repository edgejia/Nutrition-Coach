import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    root: "client",
    plugins: [react(), tailwindcss()],
    define: {
      __NC_FEEDBACK_FORM_URL__: JSON.stringify(env.VITE_FEEDBACK_FORM_URL ?? ""),
    },
    server: {
      proxy: {
        "/api": "http://localhost:3000",
      },
    },
    build: {
      outDir: "../dist/client",
    },
  };
});
