# Arquitetura

## O que roda onde

```
        SUA MÁQUINA (o "servidor caseiro")            CASA DE CADA AMIGO
┌─────────────────────────────────────────────┐   ┌──────────────────────┐
│                                             │   │                      │
│  Node.js (uma porta só, 3001)               │   │  Navegador ou app    │
│  ├── API REST     contas, servidores,       │◄──┤  React               │
│  │                canais, convites,         │   │  ├── HTTP  (REST)    │
│  │                permissões, histórico     │   │  ├── WS    (chat,    │
│  ├── WebSocket    chat em tempo real,       │◄──┤  │          presença,│
│  │                presença, signaling       │   │  │          signaling)│
│  │                WebRTC (etapa 3+)         │   │  └── WebRTC (mídia)  │
│  └── arquivos     avatares (etapa 2)        │   │                      │
│                                             │   └──────────┬───────────┘
│  SQLite (data/app.db)                       │              │
│  usuários, servidores, canais, mensagens    │              │
│                                             │      áudio/vídeo direto
│  coturn (etapa 6, processo separado)        │      entre os amigos
│  relay de mídia quando o P2P não fecha      │◄─ ─ ─ ─ ─ ─ ┘ (P2P)
└─────────────────────────────────────────────┘      só cai no TURN
                                                     quando o P2P falha
```

O ponto central: **texto passa pelo seu servidor, mídia não** (na maioria dos
casos). Chat, login e histórico são tráfego minúsculo. Áudio e vídeo vão direto
de amigo para amigo via WebRTC; sua máquina só entra no caminho da mídia quando
a conexão direta falha e o TURN precisa fazer relay — e é aí que sua banda pesa
(ver [Limites e riscos](LIMITES-E-RISCOS.md)).

## Papéis do servidor caseiro

| Papel | Como | Quando entra |
| --- | --- | --- |
| API REST | Express | Etapa 1 (pronto) |
| Banco | SQLite via `node:sqlite` | Etapa 1 (pronto) |
| Chat/presença em tempo real | Socket.io | Etapa 1 (pronto) |
| Arquivos (avatar, anexos) | pasta local servida pelo Express | Etapa 2 |
| Signaling WebRTC | os mesmos sockets do chat | Etapa 3 |
| STUN | `stun.l.google.com:19302` (público, grátis) | Etapa 3 |
| TURN | coturn, processo separado | Etapa 6 |

## Stack e por quê

**Node.js + Express + Socket.io.** O signaling do WebRTC já é troca de mensagens
por WebSocket — a mesma conexão que carrega o chat carrega o SDP e os ICE
candidates. Um processo só, uma porta só, um deploy só. Em máquina modesta, o
backend em repouso fica em algo como 60–90 MB de RAM.

**SQLite pelo módulo `node:sqlite` embutido no Node 24.** Sem servidor de banco,
sem processo extra, sem compilação nativa — o que no Windows evita a dor de
`node-gyp`/Visual Studio Build Tools. O banco é um arquivo: backup é copiar
`data/app.db`. Para um grupo de amigos, SQLite aguenta com folga (dá conta de
milhares de mensagens por segundo em escrita local). O acesso está isolado em
`server/src/db.js`, então trocar por `better-sqlite3` ou PostgreSQL depois é
mexer em um arquivo só.

> `node:sqlite` ainda é marcado como experimental. Na prática é estável para
> este uso, e o `--disable-warning=ExperimentalWarning` nos scripts npm silencia
> o aviso. Se um dia incomodar, `better-sqlite3` tem API quase idêntica.

**JWT em vez de sessão no banco.** O token é assinado com um segredo persistido
em `data/.jwt-secret`, então reiniciar o servidor não desloga ninguém. O mesmo
token autentica o REST (header `Authorization`) e o handshake do WebSocket.

**React + Vite.** Vite tem `dev server` com proxy embutido (o cliente fala com
`/api` e `/socket.io` e o Vite encaminha pro backend, sem CORS no
desenvolvimento) e HMR rápido. React é o caminho mais direto para empacotar em
Electron depois, se você quiser um app de desktop de verdade.

**Um processo, uma porta em produção.** Quando você rodar `npm run build` no
cliente, o backend detecta `client/dist` e passa a servir o app estático na mesma
porta 3001. Isso simplifica muito a etapa de exposição: é um endereço só para
abrir pra fora.

## Modelo de dados

```
users ──┬─< guild_members >─┬── guilds ──< channels ──< messages
        │                   │
        └──< messages       └──< invites
```

- `guild_members.role` é `owner` | `admin` | `member`; a hierarquia está em
  `server/src/lib/permissions.js` e é checada em toda rota que muda estado.
- IDs são `timestamp em base36 + 6 bytes aleatórios`. Como o prefixo é temporal,
  a ordem lexicográfica dos IDs é a ordem cronológica — o histórico pagina com
  `WHERE id < ?` sem precisar de índice extra nem de cursor composto.
- Deletes em cascata: apagar um canal apaga as mensagens dele; sair de um
  servidor não apaga as mensagens já enviadas.

## Eventos de tempo real

| Evento | Direção | O que faz |
| --- | --- | --- |
| `presence:sync` | servidor → cliente | lista de quem está online, no instante da conexão |
| `presence:update` | servidor → cliente | alguém entrou ou saiu |
| `message:send` | cliente → servidor | envia (com ack contendo a mensagem salva) |
| `message:new` | servidor → cliente | mensagem nova, para todo o servidor |
| `typing:start` | ambos | indicador de digitação, expira em 4s |
| `guild:subscribe` | cliente → servidor | passa a receber eventos de um servidor recém-entrado |
| `channel:created` / `channel:deleted` | servidor → cliente | mudanças na lista de canais |
| `member:joined` / `member:left` / `member:updated` | servidor → cliente | mudanças na lista de membros |

Dois detalhes que valem lembrar quando a Etapa 3 chegar:

1. **Os handlers são registrados antes de `connect()`.** O `presence:sync` é
   emitido no instante em que o socket entra, e o Socket.io não guarda eventos
   para listeners que aparecem depois. O mesmo vale para as ofertas WebRTC.
2. **Envio otimista com `nonce`.** A mensagem aparece na tela na hora, marcada
   como pendente; quando o ack (ou o broadcast) chega, o rascunho é substituído
   pela versão real, sem duplicar.

## Segurança já embutida na Etapa 1

- Senhas com bcrypt (custo 10), nunca em texto puro.
- `password_hash` e o e-mail de terceiros nunca saem do servidor: `publicUser()`
  filtra o que vai pro cliente.
- Login não diferencia "e-mail não existe" de "senha errada".
- Toda rota que lê ou escreve num servidor checa `guild_members` antes.
- WebSocket recusa a conexão sem token válido, e revalida a permissão a cada
  `message:send` — não confia no que o cliente diz.
- Rate limit de 10 mensagens a cada 5 segundos por socket.
- `ALLOW_REGISTRATION=false` fecha o cadastro depois que todos tiverem conta.
