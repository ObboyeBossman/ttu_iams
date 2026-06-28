import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;

export default defineConfig({
  root,

  // ── Multi-page app entry points ──────────────────────────────────────────
  build: {
    target: 'esnext', // Required for top-level await in supabase-client.js
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Root
        main:                path.resolve(root, 'index.html'),
        verify:              path.resolve(root, 'verify.html'),
        // Auth
        login:               path.resolve(root, 'src/modules/auth/login.html'),
        // Student
        studentDash:         path.resolve(root, 'src/modules/student/dashboard.html'),
        // Admin
        adminDash:           path.resolve(root, 'src/modules/admin_portal/dashboard/dashboard.html'),
        adminUsers:          path.resolve(root, 'src/modules/admin_portal/users/users.html'),
        adminSeasons:        path.resolve(root, 'src/modules/admin_portal/seasons/seasons.html'),
        adminZones:          path.resolve(root, 'src/modules/admin_portal/zones/zones.html'),
        adminPlacements:     path.resolve(root, 'src/modules/admin_portal/placements.html'),
        adminLettersAudit:   path.resolve(root, 'src/modules/admin_portal/letters/letters-audit.html'),
        adminSettings:       path.resolve(root, 'src/modules/admin_portal/settings/settings.html'),
        adminStudents:       path.resolve(root, 'src/modules/admin_portal/students.html'),
        // School Supervisor
        ssDash:              path.resolve(root, 'src/modules/school-supervisor/dashboard.html'),
        ssStudents:          path.resolve(root, 'src/modules/school-supervisor/students.html'),
        ssVisits:            path.resolve(root, 'src/modules/school-supervisor/visits.html'),
        // Company Supervisor
        csDash:              path.resolve(root, 'src/modules/company-supervisor/dashboard.html'),
        csCertify:           path.resolve(root, 'src/modules/company-supervisor/certify.html'),
      },
    },
  },

  // ── Path aliases ─────────────────────────────────────────────────────────
  resolve: {
    alias: {
      '/shell':   path.resolve(root, 'src/shell'),
      '/shared':  path.resolve(root, 'src/shared'),
      '/styles':  path.resolve(root, 'src/styles'),
      '/modules': path.resolve(root, 'src/modules'),
    },
  },

  // ── PWA ──────────────────────────────────────────────────────────────────
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['assets/logo/*.png', 'assets/images/*.jpg', 'assets/images/*.jpeg'],

      manifest: {
        name: 'IAMS — Takoradi Technical University',
        short_name: 'TTU IAMS',
        description: 'Industrial Attachment Management System for Takoradi Technical University students, supervisors, and administrators.',
        theme_color: '#003087',
        background_color: '#f4f6fc',
        display: 'standalone',
        start_url: '/src/modules/auth/login.html',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: 'assets/logo/ttu_logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'assets/logo/ttu_logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{html,js,css,png,jpg,jpeg,svg,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cdn-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/esm\.sh\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'esm-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],

  // ── Dev server ───────────────────────────────────────────────────────────
  server: {
    port: 5173,
    open: '/src/modules/auth/login.html',
  },
});
