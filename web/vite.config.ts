// Dashboard dev server. API routes are proxied to the SurgeAPI server so the
// page and the API share one origin (no CORS, and AuthFetch talks to /job directly).
import { defineConfig } from 'vite'

const API = 'http://localhost:3000'

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(['/price', '/state', '/network', '/swap', '/provider', '/agents', '/job', '/pass', '/.well-known'].map(path => [path, API]))
  }
})
