#!/bin/sh
# Mantem todos os nomes publicos apontando para o IPv4 atual da casa.
set -u

DOMINIOS="${DUCKDNS_DOMINIOS:-${DUCKDNS_DOMINIO:-}}"
TOKEN="${DUCKDNS_TOKEN:?defina DUCKDNS_TOKEN}"
INTERVALO="${DUCKDNS_INTERVALO_SEGUNDOS:-300}"

if [ -z "$DOMINIOS" ]; then
  echo "[duckdns] defina DUCKDNS_DOMINIOS" >&2
  exit 1
fi

descobrir_ip() {
  for servico in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
    ip=$(curl -4fsS -m 8 "$servico" 2>/dev/null | tr -d '[:space:]') || continue
    case "$ip" in
      *[!0-9.]*|'') continue ;;
      *) printf '%s' "$ip"; return 0 ;;
    esac
  done
  return 1
}

ip_anterior=""
while true; do
  ip_atual=$(descobrir_ip || true)
  if [ -z "$ip_atual" ]; then
    echo "[duckdns] nao foi possivel descobrir o IPv4 publico em $(date)" >&2
  elif [ "$ip_atual" != "$ip_anterior" ]; then
    resposta=$(curl -fsS -m 12 \
      --get \
      --data-urlencode "domains=${DOMINIOS}" \
      --data-urlencode "token=${TOKEN}" \
      --data-urlencode "ip=${ip_atual}" \
      https://www.duckdns.org/update 2>/dev/null || true)
    if [ "$resposta" = "OK" ]; then
      echo "[duckdns] ${DOMINIOS} atualizados para $ip_atual em $(date)"
      ip_anterior="$ip_atual"
    else
      echo "[duckdns] atualizacao recusada; nova tentativa em ${INTERVALO}s em $(date)" >&2
    fi
  fi
  sleep "$INTERVALO"
done
