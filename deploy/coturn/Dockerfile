# A imagem oficial do coturn não vem com curl (nem wget) - precisamos dele
# no entrypoint.sh pra descobrir o IP público atual a cada start (ver
# entrypoint.sh: o IP de casa muda, é o mesmo motivo do DuckDNS existir).
FROM coturn/coturn:4.6
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
