#!/bin/sh
# Mesmo vigia que rodava dentro do start.sh do Termux: checa o IP publico a
# cada 30s e avisa o DuckDNS quando mudar, pra discord-caseiro.duckdns.org
# sempre apontar pra casa (a operadora nao garante IP fixo).
set -e

DOMINIO="${DUCKDNS_DOMINIO:?defina DUCKDNS_DOMINIO}"
TOKEN="${DUCKDNS_TOKEN:?defina DUCKDNS_TOKEN}"

ip_anterior=""
while true; do
  ip_atual=$(curl -s -m 8 https://api.ipify.org || true)
  if [ -n "$ip_atual" ] && [ "$ip_atual" != "$ip_anterior" ]; then
    resposta=$(curl -s -m 8 "https://www.duckdns.org/update?domains=${DOMINIO}&token=${TOKEN}&ip=${ip_atual}")
    echo "[duckdns] IP mudou pra $ip_atual - resposta: $resposta em $(date)"
    ip_anterior="$ip_atual"
  fi
  sleep 30
done
