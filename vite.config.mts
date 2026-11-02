import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["icon.svg", "icon-192.png", "icon-512.png"],
        manifest: {
          name: "Хто зверху — ваше домашнє шоу",
          short_name: "Хто зверху",
          lang: "uk",
          description: "Музичне шоу для твоєї компанії",
          theme_color: "#0c0c12",
          background_color: "#0c0c12",
          display: "standalone",
          start_url: "/",
          icons: [192, 512].map((size) => ({
            src: `/icon-${size}.png`,
            sizes: `${size}x${size}`,
            type: "image/png",
            purpose: "any",
          })),
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,webp,woff2}"],
          navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/classic/],
          maximumFileSizeToCacheInBytes: 2_000_000,
        },
      }),
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api/studio": {
          target:
            env.STUDIO_API_URL || env.MUSIC_API_URL || "http://127.0.0.1:5599",
          ws: true,
        },
        "/api/music": { target: env.MUSIC_API_URL || "http://127.0.0.1:5599" },
        "/api": { target: env.STUDIO_API_URL || env.MUSIC_API_URL || "http://127.0.0.1:5599" },
        "/ws": { target: env.STUDIO_API_URL || env.MUSIC_API_URL || "http://127.0.0.1:5599", ws: true },
      },
    },
    build: {
      outDir: "dist",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes("node_modules/three/") ||
              id.includes("node_modules/@react-three/")
            )
              return "stage";
            if (
              id.includes("node_modules/motion") ||
              id.includes("node_modules/framer-motion")
            )
              return "motion";
          },
        },
      },
    },
  };
});
