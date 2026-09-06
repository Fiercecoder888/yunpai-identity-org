FROM node:24-alpine

WORKDIR /mock-upstream
COPY server.mjs .

ENV PORT=8000
EXPOSE 8000

CMD ["node", "server.mjs"]
