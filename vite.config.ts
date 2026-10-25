import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Notebook",
        short_name: "Notebook",
        description: "A calm, focused place for your thoughts — markdown notes with tags, pinning, and instant search.",
        theme_color: "#f0f0ed",
        background_color: "#f0f0ed",
        display: "standalone",
        // PNGs rendered from favicon.svg (light scheme); the maskable one is a
        // full-bleed square with the mark inside the 80 % safe zone.
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      // Register the service worker with a deferred script instead of a
      // parser-blocking one in <head>.
      injectRegister: "script-defer",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        // 404.html: served with status 404, which would fail the whole
        // precache install. og-image.png: only for link previews.
        globIgnores: ["404.html", "og-image.png"],
        // Firestore/Auth traffic must never be served from the SW cache.
        navigateFallbackDenylist: [/^\/__/],
        // The app only lives at /; other paths (legal pages, security.txt,
        // unknown URLs → 404) must come from the network or precache.
        navigateFallbackAllowlist: [/^\/(index\.html)?(\?|$)/],
      },
    }),
  ],
});
