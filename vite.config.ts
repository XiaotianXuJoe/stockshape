import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/] }),
    react()],
  server: {
    port: 3000,
  },
  resolve: {
    mainFields: ['module', 'main'],
    alias: [
      // Only match @/ prefix, not @trpc etc.
      { find: /^@\//, replacement: path.resolve(__dirname, "./src") + "/" },
      { find: "@contracts", replacement: path.resolve(__dirname, "./contracts") },
      { find: "@db", replacement: path.resolve(__dirname, "./db") },
      { find: "db", replacement: path.resolve(__dirname, "./db") },
    ],
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      treeshake: false,
      external: ["@trpc/server", "hono", "drizzle-orm", "better-sqlite3"],
    },
  },
});
