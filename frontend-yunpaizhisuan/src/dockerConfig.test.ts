/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const readRepoFile = (file: string) => readFile(join(process.cwd(), file), 'utf8');

describe('Docker production configuration', () => {
  it('requires build-time API configuration and builds a static nginx image', async () => {
    const dockerfile = await readRepoFile('Dockerfile');

    expect(dockerfile).toContain('ARG NODE_IMAGE=node:24-alpine');
    expect(dockerfile).toContain('FROM ${NODE_IMAGE} AS build');
    expect(dockerfile).toContain('ARG VITE_API_BASE_URL');
    expect(dockerfile).toContain('ARG VITE_ENABLE_MSW=false');
    expect(dockerfile).toContain('RUN test -n "$VITE_API_BASE_URL"');
    expect(dockerfile).toContain('RUN pnpm build');
    expect(dockerfile).toContain('ARG NGINX_IMAGE=nginx:alpine');
    expect(dockerfile).toContain('FROM ${NGINX_IMAGE} AS runtime');
    expect(dockerfile).toContain('COPY --from=build /app/dist /usr/share/nginx/html');
    expect(dockerfile).toContain('org.opencontainers.image.revision');
    expect(dockerfile).toContain('org.opencontainers.image.created');
    expect(dockerfile).toContain('com.yunpai.source.branch');
    expect(dockerfile).toContain('com.yunpai.source.dirty');
    expect(dockerfile).toContain('HEALTHCHECK');
  });

  it('fingerprints frontend dependencies and application sources used by the image build', async () => {
    const compose = await readRepoFile('deploy/compose.build.yml');

    expect(compose).toContain('- frontend/package.json');
    expect(compose).toContain('- frontend/pnpm-lock.yaml');
    expect(compose).toContain('- frontend/pnpm-workspace.yaml');
    expect(compose).toContain('- frontend/src');
    expect(compose).toContain('- frontend/public');
    expect(compose).toContain('- frontend/vite.config.ts');
  });

  it('uses direct Vite env reads so production flags survive bundling', async () => {
    const runtimeMode = await readRepoFile('src/app/runtimeMode.ts');

    expect(runtimeMode).toContain('VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL');
    expect(runtimeMode).toContain('VITE_ENABLE_MSW: import.meta.env.VITE_ENABLE_MSW');
    expect(runtimeMode).not.toContain('(env: RuntimeEnv = import.meta.env)');
  });

  it('keeps /api/ outside the SPA fallback', async () => {
    const nginx = await readRepoFile('nginx.conf');
    const apiBlock = nginx.match(/location\s+\/api\/\s+\{[\s\S]*?\}/)?.[0] ?? '';
    const rootBlock = nginx.match(/location\s+\/\s+\{[\s\S]*?\}/)?.[0] ?? '';

    expect(apiBlock).toContain('return 502;');
    expect(rootBlock).toContain('try_files $uri $uri/ /index.html;');
    expect(nginx.indexOf('location /api/')).toBeLessThan(nginx.indexOf('location / {'));
  });

  it('prevents stale real-mode entrypoints and mock workers from surviving deployments', async () => {
    const nginx = await readRepoFile('nginx.real-e2e.conf');
    const indexBlock = nginx.match(/location\s+=\s+\/index\.html\s+\{[\s\S]*?\}/)?.[0] ?? '';
    const workerBlock = nginx.match(/location\s+=\s+\/mockServiceWorker\.js\s+\{[\s\S]*?\}/)?.[0] ?? '';

    expect(indexBlock).toContain('Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always');
    expect(workerBlock).toContain('return 410;');
  });

  it('emits report-only security headers from the production nginx without altering routes', async () => {
    const nginx = await readRepoFile('nginx.real-e2e.conf');

    expect(nginx).toContain('X-Content-Type-Options "nosniff" always');
    expect(nginx).toContain('X-Frame-Options "DENY" always');
    expect(nginx).toContain('Referrer-Policy "no-referrer" always');
    expect(nginx).toContain('Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)" always');
    expect(nginx).toContain('Content-Security-Policy-Report-Only');
    expect(nginx).toContain('Strict-Transport-Security $hsts_header always');
    expect(nginx).toContain('map $http_x_forwarded_proto $hsts_header');

    expect(nginx).toContain('location /api/');
    expect(nginx).toContain('proxy_pass http://api-gateway:8080;');
    expect(nginx).toContain('client_max_body_size 200m;');
  });

  it('accepts production document uploads at both nginx proxy layers', async () => {
    const [frontendNginx, gatewayNginx, gatewayTemplate] = await Promise.all([
      readRepoFile('nginx.real-e2e.conf'),
      readRepoFile('api-gateway/nginx.conf'),
      readRepoFile('api-gateway/nginx.conf.template'),
    ]);

    expect(frontendNginx).toContain('client_max_body_size 200m;');
    expect(gatewayNginx).toContain('client_max_body_size 200m;');
    for (const nginx of [gatewayNginx, gatewayTemplate]) {
      const verifyStart = nginx.indexOf('location = /_internal/auth/verify');
      const verifyEnd = nginx.indexOf('\n  }', verifyStart);
      const verifyBlock = nginx.slice(verifyStart, verifyEnd);
      expect(verifyBlock).toContain('client_max_body_size 200m;');
      expect(verifyBlock).toContain('proxy_pass_request_body off;');
      expect(verifyBlock).toContain('proxy_set_header Content-Length "";');
      expect(nginx).toContain('error_page 413 = @gateway_payload_too_large;');
      expect(nginx).toContain('"code":"PAYLOAD_TOO_LARGE"');
    }
    expect(frontendNginx).toContain('error_page 413 = @frontend_payload_too_large;');
  });

  it('allows long-running document uploads through both nginx proxy layers', async () => {
    const [frontendNginx, gatewayNginx, gatewayTemplate] = await Promise.all([
      readRepoFile('nginx.real-e2e.conf'),
      readRepoFile('api-gateway/nginx.conf'),
      readRepoFile('api-gateway/nginx.conf.template'),
    ]);
    const apiBlock = frontendNginx.match(/location\s+\/api\/\s+\{[\s\S]*?\}/)?.[0] ?? '';
    expect(apiBlock).toContain('proxy_connect_timeout 10s;');
    expect(apiBlock).toContain('proxy_send_timeout 300s;');
    expect(apiBlock).toContain('proxy_read_timeout 300s;');

    const m0Block = gatewayNginx.match(/location\s+~\s+\^\/api\/m0\/\?\(\.\*\)\$[\s\S]*?\n {2}\}/)?.[0] ?? '';
    expect(m0Block).toContain('client_max_body_size 200m;');
    expect(m0Block).toContain('proxy_read_timeout 300s;');

    const m0TemplateBlock = gatewayTemplate.match(/location\s+~\s+\^\/api\/m0\/\?\(\.\*\)\$[\s\S]*?\n {2}\}/)?.[0] ?? '';
    expect(m0TemplateBlock).toContain('client_max_body_size 200m;');
    expect(m0TemplateBlock).toContain('proxy_read_timeout 300s;');
  });

  it('serves business tracking data from a read-only persistent mount', async () => {
    const [nginx, runtimeCompose, devCompose, deployEnv] = await Promise.all([
      readRepoFile('nginx.real-e2e.conf'),
      readRepoFile('deploy/compose.runtime.yml'),
      readRepoFile('deploy/compose.dev.yml'),
      readRepoFile('../deploy/source-runtime/deploy.env.example'),
    ]);

    expect(nginx).toContain('location = /historical-order-catalog.json');
    expect(nginx).toContain('alias /srv/yunpai-business-tracking/historical-order-catalog.json;');
    expect(nginx).toContain('location /run-config/');
    expect(nginx).toContain('alias /srv/yunpai-business-tracking/run-config/;');
    expect(nginx).toContain('location /uploads/');
    expect(nginx).toContain('location /history-bom/');
    expect(nginx.match(/limit_except GET HEAD/g)).toHaveLength(4);
    expect(runtimeCompose).toContain(
      '${YUNPAI_BUSINESS_TRACKING_DATA_ROOT:-/home/soft/yunpai/data/business-tracking}:/srv/yunpai-business-tracking:ro',
    );
    expect(runtimeCompose).toContain('/frontend/dist:/usr/share/nginx/html:ro');
    expect(runtimeCompose).toContain('/frontend/nginx.real-e2e.conf:/etc/nginx/conf.d/default.conf:ro');
    expect(runtimeCompose).toContain("grep -oE '/assets/[^");
    expect(runtimeCompose).toContain('wget -qO- "http://127.0.0.1$$asset"');
    expect(runtimeCompose).toContain(
      '/frontend/api-gateway/nginx.conf.template:/etc/nginx/templates/default.conf.template:ro',
    );
    expect(devCompose).toContain(
      '${YUNPAI_BUSINESS_TRACKING_DATA_ROOT:-./runtime/business-tracking}:/srv/yunpai-business-tracking:ro',
    );
    expect(deployEnv).toContain(
      'YUNPAI_BUSINESS_TRACKING_DATA_ROOT=/home/soft/yunpai/data/business-tracking',
    );
  });

  it('preserves the browser authority across both Gateway identity proxy paths', async () => {
    const [frontendNginx, nginx, nginxTemplate, identityRuntimeCompose] = await Promise.all([
      readRepoFile('nginx.real-e2e.conf'),
      readRepoFile('api-gateway/nginx.conf'),
      readRepoFile('api-gateway/nginx.conf.template'),
      readRepoFile('../identity-bff/deploy/compose.runtime.yml'),
    ]);
    const verifyStart = nginx.indexOf('location = /_internal/auth/verify');
    const verifyEnd = nginx.indexOf('\n  }', verifyStart);
    const verifyBlock = nginx.slice(verifyStart, verifyEnd);
    const authStart = nginx.indexOf('location ~ ^/api/auth/');
    const authEnd = nginx.indexOf('\n  }', authStart);
    const authBlock = nginx.slice(authStart, authEnd);

    expect(verifyStart).toBeGreaterThanOrEqual(0);
    expect(verifyBlock).toContain('proxy_set_header Host $http_host;');
    expect(verifyBlock).toContain('proxy_set_header X-Forwarded-Host $http_host;');
    expect(verifyBlock).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(verifyBlock).toContain('proxy_set_header Cookie $http_cookie;');
    expect(authStart).toBeGreaterThanOrEqual(0);
    expect(authBlock).toContain('proxy_set_header Host $http_host;');
    expect(authBlock).toContain('proxy_set_header X-Forwarded-Host $http_host;');
    expect(authBlock).toContain('proxy_set_header X-Forwarded-Proto $scheme;');
    expect(authBlock).toContain('proxy_set_header Origin $http_origin;');
    expect(authBlock).toContain('proxy_set_header Referer $http_referer;');
    expect(authBlock).toContain('proxy_set_header Cookie $http_cookie;');
    expect(frontendNginx).toContain('proxy_set_header Origin $http_origin;');
    expect(frontendNginx).toContain('proxy_set_header Referer $http_referer;');
    expect(frontendNginx).toContain('proxy_set_header Cookie $http_cookie;');
    expect(frontendNginx).toContain('proxy_set_header X-CSRF-Token $http_x_csrf_token;');
    expect(nginx).toContain('set $upstream_identity http://yunpai-primary-identity-bff:9100;');
    const m0Start = nginxTemplate.indexOf('location ~ ^/api/m0/?(.*)$');
    const m0End = nginxTemplate.indexOf('\n  }', m0Start);
    const m0Block = nginxTemplate.slice(m0Start, m0End);
    expect(m0Block).toContain('proxy_set_header X-M0-API-Key "${M0_GATEWAY_API_KEY}";');
    expect(m0Block).toContain('auth_request_set $m0_principal $upstream_http_x_yunpai_principal;');
    expect(m0Block).toContain('auth_request_set $m0_roles $upstream_http_x_yunpai_roles;');
    expect(m0Block).toContain('auth_request_set $m0_tenant $upstream_http_x_yunpai_tenant;');
    expect(m0Block).toContain('proxy_set_header X-Yunpai-Principal $m0_principal;');
    expect(m0Block).toContain('proxy_set_header X-Yunpai-Roles $m0_roles;');
    expect(m0Block).toContain('proxy_set_header X-Yunpai-Tenant $m0_tenant;');
    expect(identityRuntimeCompose).toContain('- yunpai-primary-identity-bff');
  });

  it('uses dedicated fail-closed identity-proxy credentials for M3 and M4', async () => {
    const [gatewayTemplate, staticGateway, runtimeCompose, devCompose, envExample, dockerfile] = await Promise.all([
      readRepoFile('api-gateway/nginx.conf.template'),
      readRepoFile('api-gateway/nginx.conf'),
      readRepoFile('deploy/compose.runtime.yml'),
      readRepoFile('deploy/compose.dev.yml'),
      readRepoFile('.env.example'),
      readRepoFile('api-gateway/Dockerfile'),
    ]);
    const locationBlock = (source: string, module: 'm3' | 'm4') =>
      source.match(new RegExp(`location\\s+~\\s+\\^/api/${module}[\\s\\S]*?\\n {2}\\}`))?.[0] ?? '';

    for (const [module, variable] of [
      ['m3', 'M3_GATEWAY_SERVICE_TOKEN'],
      ['m4', 'M4_GATEWAY_SERVICE_TOKEN'],
    ] as const) {
      const templateBlock = locationBlock(gatewayTemplate, module);
      const fallbackBlock = locationBlock(staticGateway, module);

      expect(templateBlock).toContain('auth_request /_internal/auth/verify;');
      expect(templateBlock).toContain(`proxy_set_header Authorization "Bearer \${${variable}}";`);
      expect(templateBlock).toContain(`proxy_set_header X-Yunpai-Principal $${module}_principal;`);
      expect(templateBlock).toContain(`proxy_set_header X-Yunpai-Roles $${module}_roles;`);
      expect(templateBlock).toContain(`proxy_set_header X-Yunpai-Tenant $${module}_tenant;`);
      expect(templateBlock).toContain(`proxy_set_header X-Yunpai-Data-Scope $${module}_data_scope;`);
      expect(templateBlock).toContain(`proxy_set_header X-Yunpai-User-Name $${module}_user_name;`);
      expect(templateBlock).toContain(
        `proxy_set_header X-Yunpai-User-Name-Encoding $${module}_user_name_encoding;`,
      );
      expect(fallbackBlock).toContain('auth_request /_internal/auth/verify;');
      expect(fallbackBlock).toContain('proxy_set_header Authorization "";');
      expect(fallbackBlock).not.toContain(variable);
      expect(runtimeCompose).toContain(`${variable}: "\${${variable}:-}"`);
      expect(devCompose).toContain(`${variable}: "\${${variable}:-}"`);
      expect(envExample).toContain(`${variable}=`);
      expect(dockerfile).toContain(`${variable}=""`);
    }

    const genericM3Needle = 'location ~ ^/api/m3/?(.*)$';
    const genericTemplateStart = gatewayTemplate.indexOf(genericM3Needle);
    const genericTemplateEnd = gatewayTemplate.indexOf('\n  }', genericTemplateStart);
    const genericTemplateBlock = gatewayTemplate.slice(genericTemplateStart, genericTemplateEnd);
    const genericFallbackStart = staticGateway.indexOf(genericM3Needle);
    const genericFallbackEnd = staticGateway.indexOf('\n  }', genericFallbackStart);
    const genericFallbackBlock = staticGateway.slice(genericFallbackStart, genericFallbackEnd);

    expect(genericTemplateStart).toBeGreaterThanOrEqual(0);
    expect(genericTemplateBlock).toContain(
      'auth_request_set $internal_authorization $upstream_http_x_yunpai_internal_authorization;',
    );
    expect(genericTemplateBlock).toContain('proxy_set_header Authorization $internal_authorization;');
    expect(genericTemplateBlock).not.toContain('M3_GATEWAY_SERVICE_TOKEN');
    expect(genericFallbackStart).toBeGreaterThanOrEqual(0);
    expect(genericFallbackBlock).toContain('proxy_set_header Authorization $internal_authorization;');
    expect(dockerfile).toContain('M0_GATEWAY_API_KEY=""');
  });

  it('excludes local-only artifacts from the Docker build context', async () => {
    const dockerignore = await readRepoFile('.dockerignore');

    expect(dockerignore).toContain('node_modules');
    expect(dockerignore).toContain('dist');
    expect(dockerignore).toContain('.env');
    expect(dockerignore).toContain('.env.local');
    expect(dockerignore).toContain('*Prompt*.md');
    expect(dockerignore).toContain('*report*.md');
    expect(dockerignore).toContain('Docker-package-validation-report-*.md');
  });

  it('restarts the Lenovo frontend stack after the WSL Docker daemon restarts', async () => {
    const compose = await readRepoFile('docker-compose.lenovo.yml');

    expect(compose.match(/restart: unless-stopped/g)).toHaveLength(2);
  });
});
