# Discord Caseiro

Comunicação em tempo real self-hosted: o backend inteiro (API, banco, WebSocket e,
mais pra frente, signaling WebRTC + TURN) roda numa máquina sua. Seus amigos só
rodam o cliente.

**Estado atual: Etapa 1 concluída e testada localmente** — contas, servidores,
canais, permissões, chat de texto em tempo real com histórico persistente e
presença online/offline.

## Rodando (duas janelas de terminal)

Backend:

```bash
cd C:\projetos\discord-caseiro\server && npm run dev
```

Cliente:

```bash
cd C:\projetos\discord-caseiro\client && npm run dev
```

Depois abra <http://localhost:5220>. Na primeira vez, clique em
"Não tenho conta ainda" para criar a sua.

Teste automatizado de ponta a ponta (com o backend rodando):

```bash
cd C:\projetos\discord-caseiro\server && npm run smoke
```

## Testando com dois usuários

O jeito mais rápido é abrir uma janela anônima do navegador (o token fica no
`localStorage`, então duas abas normais compartilham a mesma conta). Crie a
segunda conta, gere um convite na primeira (botão `+` ao lado do nome do
servidor) e entre com o código.

Para testar de outro aparelho da mesma rede local, use o IP da sua máquina:
`http://192.168.x.x:5220`. O Vite já escuta em todas as interfaces.

## Estrutura

```
server/          backend Node: API REST + WebSocket + SQLite
  src/routes/    auth, guilds, channels, invites
  src/lib/       auth, permissões, serialização, ids
  scripts/       smoke test de ponta a ponta
client/          app React (Vite)
data/            banco SQLite e segredo do JWT (fora do controle de versão)
docs/            arquitetura, plano de etapas, limites e exposição futura
```

## Documentação

- [Arquitetura](docs/ARQUITETURA.md) — o que roda na sua máquina e o que roda na dos amigos
- [Plano de etapas](docs/PLANO.md) — inclui **em qual etapa exatamente** o projeto passa a depender de exposição à internet
- [Limites e riscos](docs/LIMITES-E-RISCOS.md) — banda do TURN, teto de participantes, segurança
- [Exposição à internet](docs/EXPOSICAO-INTERNET.md) — etapa futura, ainda **não** implementada

## Configuração

`server/.env` (copiado de `.env.example`):

| Variável | Para que serve |
| --- | --- |
| `PORT` | porta da API + WebSocket (padrão 3001) |
| `CLIENT_ORIGIN` | origens liberadas no CORS, separadas por vírgula |
| `JWT_SECRET` | se vazio, é gerado uma vez e guardado em `data/.jwt-secret` |
| `DB_PATH` | caminho do arquivo SQLite |
| `ALLOW_REGISTRATION` | vire `false` depois que todo mundo tiver conta |
