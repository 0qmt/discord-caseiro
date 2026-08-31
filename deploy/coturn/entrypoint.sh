#!/bin/sh
# O IP publico de casa muda de vez em quando (por isso o DuckDNS existe) -
# descobrimos o atual toda vez que o container sobe (reinicio, deploy,
# update do Umbrel) e passamos pro turnserver via linha de comando.
#
# O IP local TAMBEM pode mudar (o roteador reatribui outro DHCP depois de
# um reinicio, ja aconteceu) - por isso não fica mais fixo em variável de
# ambiente nenhuma: descobrimos sozinho a cada start, lendo a rota padrão
# do próprio host (o container roda em network_mode: host, então essa rota
# é a mesma do Umbrel na rede de casa).
set -e

IP_PUBLICO=$(curl -s --max-time 8 https://api.ipify.org || true)
IP_LOCAL="${TURN_LOCAL_IP:-$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}')}"

if [ -z "$IP_LOCAL" ]; then
  echo "[coturn] nao consegui descobrir o IP local sozinho, saindo"
  exit 1
fi

if [ -z "$IP_PUBLICO" ]; then
  echo "[coturn] nao consegui descobrir o IP publico agora, usando so o IP local ($IP_LOCAL)"
  EXTERNAL_ARG="--relay-ip=$IP_LOCAL"
else
  echo "[coturn] IP publico atual: $IP_PUBLICO / IP local: $IP_LOCAL"
  EXTERNAL_ARG="--external-ip=$IP_PUBLICO/$IP_LOCAL --relay-ip=$IP_LOCAL"
fi

exec turnserver -c /etc/coturn/turnserver.conf $EXTERNAL_ARG --log-file=stdout
