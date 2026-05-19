
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from './package.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve('.'), '');
  
  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
      watch: {
        ignored: [
          '**/database/**',
          '**/uploads/**',
          '**/temp/**',
          '**/sync-runtime/**',
          '**/dist_electron/**',
        ],
      },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
          // No usamos rewrite para que el backend reciba el prefijo /api tal como está configurado
        }
      }
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY || env.GEMINI_API_KEY),
      __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './'),
      }
    }
  };
});
