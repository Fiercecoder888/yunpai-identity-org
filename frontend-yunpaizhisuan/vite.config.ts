import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
// @ts-expect-error The build helper is intentionally plain Node ESM so release scripts can reuse it directly.
import { createBuildMetaTags, resolveBuildMetadata, serializeBuildMetadata } from './scripts/build-metadata.mjs';
import { chatHistoryDevPlugin } from './dev/chatHistoryMiddleware';

const buildMetadata = resolveBuildMetadata();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMswDemo = env.VITE_ENABLE_MSW !== 'false' && !env.VITE_API_BASE_URL;

  return {
    plugins: [
      react(),
      ...(useMswDemo ? [chatHistoryDevPlugin()] : []),
      {
        name: 'yunpai-build-info',
        transformIndexHtml() {
          return createBuildMetaTags(buildMetadata);
        },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'build-info.json', source: serializeBuildMetadata(buildMetadata) });
        },
      },
    ],
    resolve: {
      alias: {
        'antd/es/version': 'antd/es/version/index.js',
      },
    },
    server: {
      // 本地浏览器验收：真实模式下把 /api/orchestrator 代理到本地编排器，
      // MSW demo 模式不经网络，不受影响。
      proxy: {
        // M0 模块后端（本地 m0_backend :8010 提供 /api/m0/*；orchestrator 不暴露这些路由）。
        // 仅本地开发走此分流；生产由 api-gateway 路由到 m0 服务。
        '/api/m0': {
          target: env.YUNPAI_LOCAL_M0_URL || process.env.YUNPAI_LOCAL_M0_URL || 'http://127.0.0.1:8010',
          changeOrigin: true,
        },
        '/api': {
          target: env.YUNPAI_LOCAL_BACKEND_URL || process.env.YUNPAI_LOCAL_BACKEND_URL || 'http://127.0.0.1:9000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (id.includes('/echarts/') || id.includes('/zrender/')) {
              return 'chart-vendor';
            }
            if (id.includes('/@xyflow/')) {
              return 'flow-vendor';
            }
            if (id.includes('/antd/') || id.includes('/@ant-design/') || id.includes('/@rc-component/')) {
              return 'antd-vendor';
            }
            if (
              id.includes('/@tanstack/') ||
              id.includes('/zustand/') ||
              id.includes('/react-router') ||
              id.includes('/react-dom/') ||
              id.includes('/react/')
            ) {
              return 'react-vendor';
            }
            return undefined;
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
      globals: true,
      setupFiles: './src/tests/setup.ts',
      testTimeout: 20_000,
      hookTimeout: 20_000,
      fileParallelism: false,
      server: {
        deps: {
          inline: ['antd', '@ant-design/icons', '@ant-design/x'],
        },
      },
    },
  };
});
