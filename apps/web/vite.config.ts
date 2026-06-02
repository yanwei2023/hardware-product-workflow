import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/agent": "http://127.0.0.1:3001",
      "/gates": "http://127.0.0.1:3001",
      "/health": "http://127.0.0.1:3001",
      "/projects": "http://127.0.0.1:3001",
      "/reviews": "http://127.0.0.1:3001",
      "/risks": "http://127.0.0.1:3001",
      "/storage": "http://127.0.0.1:3001",
      "/templates": "http://127.0.0.1:3001",
      "/users": "http://127.0.0.1:3001",
      "/work-packages": "http://127.0.0.1:3001",
    },
  },
});
