import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons.svg"],
      manifest: {
        name: "Notebook",
        short_name: "Notebook",
        description: "A calm, focused place for your thoughts — markdown notes with tags, pinning, and instant search.",
        theme_color: "#f0f0ed",
        background_color: "#f0f0ed",
        display: "standalone",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        // Firestore/Auth traffic must never be served from the SW cache.
        navigateFallbackDenylist: [/^\/__/],
      },
    }),
  ],
});
