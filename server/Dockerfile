# Builda o client e a landing (o server serve os dois prontos em producao -
# ver src/index.js) e depois roda so o server, sem carregar node_modules de
# build (vite etc.) pra dentro da imagem final.
FROM node:22-slim AS build-client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-slim AS build-landing
WORKDIR /app/landing
COPY landing/package*.json ./
RUN npm ci
COPY landing/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=build-client /app/client/dist ../client/dist
COPY --from=build-landing /app/landing/dist ../landing/dist

EXPOSE 3001
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
