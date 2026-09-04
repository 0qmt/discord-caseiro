# Migração do Discord Caseiro: Termux → UmbrelOS

## Contexto

Hoje o Discord Caseiro roda inteiro num celular Android via Termux
(`192.168.0.5`, SSH porta 8022), orquestrado por `start.sh`, que sobe quatro
processos e reinicia sozinho qualquer um que caia:

1. **Servidor Node** (`server/src/index.js`) — API + WebSocket + serve o
   build do client e da landing.
2. **coturn** (TURN server), rodando dentro de um `proot-distro` Alpine,
   porque o Android/Termux não tem como abrir porta de verdade pro mundo
   sem root.
3. **Túnel Pinggy** expondo o coturn — reconecta a cada ~1h com um endereço
   novo (host:porta muda toda vez), porque é grátis e o celular não tem IP
   público nem porta encaminhada pra ele.
4. **Vigia de DuckDNS** — atualiza `discord-caseiro.duckdns.org` sempre que
   o IP da operadora muda (a Vivo não garante IP fixo).

O usuário instalou um servidor dedicado rodando **UmbrelOS** (Debian 13 por
baixo, Docker 28 + Compose v5 já disponíveis) na mesma rede de casa,
endereço `192.168.0.63`, e quer migrar tudo pra lá e desligar o Termux de
vez.

Investigação feita na sessão anterior à escrita desta spec, direto no
Umbrel via SSH (usuário `umbrel`, distinto do login do painel web):

- Docker 28.5.0 / Compose v5.3.1 já instalados; 211GB livres na partição de
  dados; nenhuma porta em uso que conflite (3001 e 3478 estão livres).
- **O sistema de arquivos raiz do UmbrelOS NÃO é persistente entre updates**
  (aviso exibido no próprio SSH) — só o que mora em `/home/umbrel/...`
  sobrevive. Isso descarta "só copiar os arquivos e rodar `node` direto":
  precisa ser Docker, com os dados em volume montado sob `/home/umbrel`.
- O app desktop já aponta por padrão pra
  `http://discord-caseiro.duckdns.org:3001` (não pro IP do celular) — ver
  `desktop/src/config.js`. Migrando o destino por trás do DNS, nenhum
  usuário do app precisa reconfigurar nada.
- O `coturn` de hoje usa credenciais estáticas simples (usuário/senha fixos,
  realm `discordcaseiro`, sem TLS) — configuração trivial de portar.

## Decisões já tomadas com o usuário

- **Onde roda**: Docker Compose direto via SSH no Umbrel — não como app
  formal da loja do Umbrel (ganho estético não justifica o trabalho extra
  de empacotamento pra um app de uso pessoal).
- **Fim do Termux**: desligar de vez depois de confirmar que a migração
  funcionou (sem manter como fallback).
- **Prioridade**: "quero que tudo funcione igual" — a migração deve ser
  transparente pra quem usa o app; nenhuma mudança de comportamento visível.

## Arquitetura alvo

Um `docker-compose.yml` novo, vivendo em `/home/umbrel/discord-caseiro/` no
Umbrel, com três serviços:

### 1. `servidor`
Imagem construída a partir de um `Dockerfile` novo em `server/` (Node 22,
igual à versão que já roda no celular — `engines.node: ">=22.5"` no
`package.json`). No build da imagem, também gera o build de produção do
`client` e da `landing` (os dois `vite build`), porque `server/src/index.js`
serve os dois a partir de `client/dist` e `landing/dist` em produção — ver
`server/src/index.js:74-90`.

- Porta publicada: `3001:3001` (igual hoje).
- Variáveis de ambiente **idênticas** às que já estão em uso no `.env` de
  produção do celular hoje (`PORT=3001`,
  `CLIENT_ORIGIN=http://discord-caseiro.duckdns.org:3001`, `DB_PATH`,
  `ALLOW_REGISTRATION=true`, `GIPHY_API_KEY`, `JWT_SECRET` vazio pra gerar
  sozinho) — copiadas como estão, sem decidir nada novo aqui.
- Endereço do TURN passa a ser **fixo** via env vars (`TURN_HOST`,
  `TURN_PORT`), não mais lido de um arquivo que um túnel reescreve.
- Volume: `./data:/app/data`, contendo `app.db`, `uploads/`, `reports/`
  migrados do celular (228MB no total — não migra `data/updates/`, que são
  só os instaladores do desktop publicados no GitHub Release, nem
  `turn-endpoint.json`, que fica obsoleto).

### 2. `turn`
Imagem oficial `coturn/coturn`, `network_mode: host` (mais simples que
mapear a faixa de portas de relay uma por uma — o Umbrel é uma máquina
dedicada só pra isso, então usar a rede do host não tem o risco que teria
numa máquina compartilhada). Config equivalente à de hoje
(usuário/senha/realm iguais, pra não invalidar nada), com uma faixa de
portas de relay explícita (`min-port`/`max-port`, ex. 49160–49200) em vez de
depender do range default gigante do coturn — mais fácil de liberar no
roteador depois.

### 3. `duckdns`
Container pequeno (script simples, sem imagem de terceiro) rodando o mesmo
loop que já existe em `start.sh`: checa o IP público a cada 30s e avisa o
DuckDNS quando mudar. Mantém `discord-caseiro.duckdns.org` funcionando
exatamente como hoje, só que rodando no Umbrel em vez do celular.

## Mudança de código

- **`server/src/lib/turn.js`**: reescrito para retornar um `turnServers()`
  fixo a partir de env vars (`TURN_HOST`/`TURN_PORT`), removendo toda a
  lógica de ler `turn-endpoint.json` — não existe mais túnel que reconecta.
- **`server/src/config.js`**: usuário/senha do TURN continuam vindo de env
  var, sem mudança de formato.
- Nenhuma mudança em client, desktop ou landing — eles não sabem nem
  precisam saber que o backend trocou de máquina.

## Passo manual do usuário (fora do meu alcance)

No roteador de casa, trocar o destino do encaminhamento de porta de
`192.168.0.5` (celular) pra `192.168.0.63` (Umbrel), para:
- `3001` (TCP) — o app em si.
- `3478` (TCP **e** UDP) — TURN (hoje só passava por túnel Pinggy só-TCP;
  a partir daqui, aberto direto, com UDP de verdade — deve até melhorar a
  qualidade de chamada).
- A faixa de relay escolhida pro coturn (ex. `49160–49200`, TCP e UDP).

Vou dar o passo a passo exato (nomes de campo variam por roteador) quando
chegar nessa etapa do plano.

## Plano de corte (sem downtime perceptível)

1. Subir os três containers no Umbrel com os dados já copiados, **com o
   celular ainda no ar** — nada em produção é afetado ainda.
2. Testar localmente contra o Umbrel (`http://192.168.0.63:3001`): login
   com a conta existente, mensagens antigas aparecem, chamada de voz
   conecta e o TURN funciona.
3. Só depois de validado: usuário troca o encaminhamento de porta no
   roteador.
4. Confirmar que `discord-caseiro.duckdns.org` responde através do Umbrel.
5. Desligar o `start.sh` no celular (matar os processos) e, com a
   confirmação do usuário de que está tudo funcionando, desinstalar/liberar
   o Termux.

## Teste

- Reusar o `server/scripts/smoke.js` e `server/scripts/smoke-config-servidor.js`
  existentes, rodando contra `http://192.168.0.63:3001` — mesmo padrão já
  usado nesta sessão pra validar o celular depois de cada deploy.
- Teste manual de chamada de voz entre dois dispositivos reais (o smoke não
  cobre WebRTC/TURN de ponta a ponta).

## Fora de escopo

- Empacotar como app formal da loja de apps do Umbrel.
- Qualquer mudança de comportamento do app pro usuário final.
- HTTPS/TLS (o setup atual já é HTTP simples atrás de NAT; continua assim).
