#!/bin/sh
# O IP publico de casa muda de vez em quando (por isso o DuckDNS existe) -
# descobrimos o atual toda vez que o container sobe (reinicio, deploy,
# update do Umbrel) e passamos pro turnserver via linha de comando, junto
# do IP local fixo do proprio Umbrel na rede de casa.
set -e

IP_PUBLICO=$(curl -s --max-time 8 https://api.ipify.org || true)
IP_LOCAL="${TURN_LOCAL_IP:?defina TURN_LOCAL_IP com o IP do Umbrel na rede local}"

if [ -z "$IP_PUBLICO" ]; then
  echo "[coturn] nao consegui descobrir o IP publico agora, usando so o IP local ($IP_LOCAL)"
  EXTERNAL_ARG="--relay-ip=$IP_LOCAL"
else
  echo "[coturn] IP publico atual: $IP_PUBLICO / IP local: $IP_LOCAL"
  EXTERNAL_ARG="--external-ip=$IP_PUBLICO/$IP_LOCAL --relay-ip=$IP_LOCAL"
fi

exec turnserver -c /etc/coturn/turnserver.conf $EXTERNAL_ARG --log-file=stdout
