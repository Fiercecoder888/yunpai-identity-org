ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY \
    npm_config_registry=$NPM_REGISTRY
RUN corepack enable \
    && corepack prepare pnpm@10.14.0 --activate \
    && pnpm config set registry "$NPM_REGISTRY"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_ENABLE_MSW=false
ARG VITE_LENOVO_TEST_IDENTITY=false
ARG YUNPAI_BUILD_COMMIT=unknown
ARG YUNPAI_BUILD_BRANCH=unknown
ARG YUNPAI_BUILD_TIME=unknown
ARG YUNPAI_BUILD_DIRTY=true
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_ENABLE_MSW=$VITE_ENABLE_MSW
ENV VITE_LENOVO_TEST_IDENTITY=$VITE_LENOVO_TEST_IDENTITY
ENV YUNPAI_BUILD_COMMIT=$YUNPAI_BUILD_COMMIT
ENV YUNPAI_BUILD_BRANCH=$YUNPAI_BUILD_BRANCH
ENV YUNPAI_BUILD_TIME=$YUNPAI_BUILD_TIME
ENV YUNPAI_BUILD_DIRTY=$YUNPAI_BUILD_DIRTY

RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL build arg is required" && exit 1)
RUN pnpm build

FROM ${NGINX_IMAGE} AS runtime
ARG NGINX_CONF=nginx.real-e2e.conf
ARG YUNPAI_BUILD_COMMIT=unknown
ARG YUNPAI_BUILD_BRANCH=unknown
ARG YUNPAI_BUILD_TIME=unknown
ARG YUNPAI_BUILD_DIRTY=true
LABEL org.opencontainers.image.revision=$YUNPAI_BUILD_COMMIT \
      org.opencontainers.image.created=$YUNPAI_BUILD_TIME \
      com.yunpai.source.branch=$YUNPAI_BUILD_BRANCH \
      com.yunpai.source.dirty=$YUNPAI_BUILD_DIRTY
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
