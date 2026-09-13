# Tailscale Funnel de reserva do discordia

O acesso principal dos aplicativos usa o HTTPS direto em
`https://discord-caseiro.duckdns.org:3001`. A Funnel permanece ativa somente
como rota de diagnostico e emergencia.

O estado e a configuracao da Funnel ficam persistidos em:

`/home/umbrel/umbrel/app-data/pepo-tailscale/state`

O container usa `restart: unless-stopped`, portanto volta junto com o Umbrel.
Depois do primeiro login, a Funnel foi configurada com:

```sh
tailscale funnel --bg --https=443 http://127.0.0.1:3002
```

Endereco publico de reserva:

`https://discordia.tail291b3e.ts.net`

Para conferir sem alterar nada:

```sh
docker exec pepo-tailscale-funnel tailscale status
docker exec pepo-tailscale-funnel tailscale funnel status
```
