ARG NGINX_IMAGE=nginx:alpine
FROM ${NGINX_IMAGE}

# The official nginx entrypoint runs envsubst over /etc/nginx/templates/*.template
# before starting. Empty defaults ensure protected module routes fail closed
# when their dedicated browser identity-proxy credential is not configured.
ENV M0_GATEWAY_API_KEY="" \
    M3_GATEWAY_SERVICE_TOKEN="" \
    M4_GATEWAY_SERVICE_TOKEN="" \
    M5_GATEWAY_API_KEY="" \
    M7_HOST="host.docker.internal" \
    M7_PORT="49706"
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/gateway/health >/dev/null || exit 1
