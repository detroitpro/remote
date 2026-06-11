import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const relayPort = Number(env.CURSOR_REMOTE_RELAY_PORT || 3000);
  const relayTarget = `http://127.0.0.1:${relayPort}`;

  return {
    root: 'src/client',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 3001,
      strictPort: true,
      proxy: {
        '/socket.io': { target: relayTarget, ws: true },
        '/health': relayTarget,
        '/debug': relayTarget,
        '/api': relayTarget,
        '/login': relayTarget,
      },
    },
    build: {
      outDir: '../../dist/client',
      emptyOutDir: true,
    },
  };
});
