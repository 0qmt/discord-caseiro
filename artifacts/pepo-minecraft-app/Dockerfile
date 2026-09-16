# Painel + runtime do servidor Paper. Java 25 vem da imagem base.
FROM eclipse-temurin:25-jre

RUN apt-get update && apt-get install -y --no-install-recommends \
      nodejs zip unzip ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js /app/server.js
COPY public /app/public

ENV MC_DATA=/data \
    PANEL_PORT=8080 \
    NODE_ENV=production

EXPOSE 8080
# porta do jogo é publicada pelo docker-compose (25565)

CMD ["node", "--no-warnings", "/app/server.js"]
