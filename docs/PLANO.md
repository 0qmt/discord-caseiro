# Plano de implementação

Todas as etapas de 1 a 6 rodam **só na sua máquina** (ou na sua rede local).
Você consegue testar sozinho, ou com dois aparelhos seus, sem expor nada.

> ## ⚠️ A etapa que muda tudo: **Etapa 7**
>
> **A Etapa 7 é o primeiro momento em que seus amigos precisam se conectar de
> verdade no seu servidor pela internet.** Até o fim da Etapa 6, nada sai da sua
> rede: você testa com duas abas, duas contas e, no máximo, um segundo aparelho
> no mesmo Wi-Fi. A partir da Etapa 7 o projeto passa a depender de DNS
> dinâmico + redirecionamento de portas, ou de um túnel — e aí entram HTTPS,
> senha forte e manutenção. Nada disso está implementado ainda, de propósito.

---

## Etapa 1 — Contas, servidores, canais e chat de texto ✅ pronta

Feito e testado localmente:

- cadastro e login com e-mail/senha, sessão que sobrevive a reiniciar o servidor
- criar servidor (nasce com um canal de texto e um de voz)
- convites por código de 8 caracteres, com validação, expiração e limite de usos
- canais de texto e de voz (o de voz ainda é só um lugar reservado)
- permissões dono / admin / membro aplicadas no servidor, não só na interface
- chat em tempo real, envio otimista, histórico paginado e persistente
- presença online/offline e indicador de digitação
- 34 verificações automatizadas em `npm run smoke`

**Por que servidores e canais vieram junto do chat:** um chat sem canal é
artificial, e ter a estrutura de servidor pronta agora significa que a voz da
Etapa 4 só precisa se plugar num canal que já existe.

## Etapa 2 — Foto de perfil com recorte, incluindo GIF

- upload para uma pasta local (`data/uploads/`), servida pelo Express
- `react-easy-crop` no cliente para arrastar e dar zoom antes de salvar
- **imagem estática:** o recorte é aplicado num `<canvas>` e sobe já cortada
- **GIF animado:** o canvas mataria a animação (viraria um PNG parado). A saída
  barata é guardar o GIF original mais os parâmetros do recorte (`x`, `y`,
  `zoom`) e aplicar o corte na exibição, com CSS (`object-fit` + `transform`
  dentro de um contêiner redondo com `overflow: hidden`). Zero dependência
  nativa e a animação continua rodando. Se um dia você quiser o recorte
  "queimado" no arquivo, aí sim entra `gifsicle` ou `ffmpeg` no servidor.
- limite de tamanho, checagem do tipo real do arquivo (não confiar na extensão)

## Etapa 3 — Chamada 1-a-1 (WebRTC)

- signaling pelos sockets que já existem: `call:offer`, `call:answer`,
  `call:ice`, `call:end`
- `RTCPeerConnection` com STUN público (`stun.l.google.com:19302`)
- áudio primeiro, câmera como opção
- **Teste local funciona:** duas abas em `http://localhost:5220` conversam
  normalmente, porque `localhost` conta como contexto seguro para o navegador.
- **Cuidado:** `getUserMedia()` só funciona em contexto seguro. Testar entre dois
  aparelhos da rede local por IP (`http://192.168.x.x`) **não** é contexto
  seguro, e o navegador bloqueia o microfone. Para esse teste, use
  `chrome://flags/#unsafely-treat-insecure-origin-as-secure` no aparelho de
  teste, ou pule direto pra Etapa 7 quando for a hora — não é um bug seu.

## Etapa 4 — Canais de voz do servidor

- entrar/sair do canal, com a lista de quem está dentro em tempo real
- malha ponto a ponto: cada pessoa abre uma conexão com cada uma das outras
- indicador de quem está falando via `AnalyserNode` da Web Audio API
- mute, desativar áudio dos outros, ligar/desligar câmera
- **Aqui é o teto prático:** veja a conta de conexões e banda em
  [Limites e riscos](LIMITES-E-RISCOS.md). Confortável até 4–5 pessoas com
  vídeo; 8–10 se for só áudio.

## Etapa 5 — Compartilhamento de tela

- `getDisplayMedia()` e `RTCRtpSender.replaceTrack()` para trocar a câmera pela
  tela sem derrubar a conexão
- escolher entre tela inteira, janela ou aba; áudio da aba quando o navegador
  deixar
- layout de quem está apresentando

## Etapa 6 — TURN caseiro (coturn)

- coturn com credenciais de tempo limitado (não usuário e senha fixos)
- o cliente passa a receber a lista de `iceServers` do backend, com STUN público
  primeiro e o seu TURN como reserva
- **No Windows não existe coturn nativo decente.** Rode via WSL2 ou Docker
  Desktop. Se o servidor caseiro definitivo for um mini PC ou Raspberry Pi com
  Linux, é `apt install coturn` e pronto.
- **Dá para validar a configuração sem expor nada:** force
  `iceTransportPolicy: 'relay'` no `RTCPeerConnection` de teste. Se a chamada
  fechar assim, o TURN está funcionando. O valor real dele (rede com CGNAT) só
  aparece na Etapa 7, mas a configuração você confere agora.

## ⚠️ Etapa 7 — Expor o servidor para a internet

**Primeiro momento em que amigos de fora entram de verdade.** Documentada em
[EXPOSICAO-INTERNET.md](EXPOSICAO-INTERNET.md), sem nenhuma implementação — é o
que você vai me pedir quando as etapas anteriores estiverem funcionando.

Envolve: escolher entre DNS dinâmico + redirecionamento de portas ou um túnel,
HTTPS (obrigatório, senão nem microfone nem tela funcionam fora de
`localhost`), fechar o cadastro, rate limit no login e backup do banco.

## Etapa 8 — Opcionais, quando der vontade

- anexos de imagem e arquivo no chat
- DMs de texto (a chamada 1-a-1 já existe desde a Etapa 3)
- empacotar em Electron, com notificação e tecla de atalho global
- notificações e menções
- se o grupo crescer muito: trocar a malha P2P por um SFU (mediasoup ou LiveKit)
  — mais gente na chamada, mais carga na sua máquina

---

## Ordem sugerida de trabalho

```
[1] contas + chat  ──►  [2] avatar  ──►  [3] chamada 1-a-1  ──►  [4] voz no canal
     ✅ pronto                                                          │
                                                                        ▼
                        [7] ⚠️ internet  ◄──  [6] TURN  ◄──  [5] tela
                             amigos entram
```

Dá para trocar a Etapa 2 de lugar sem problema — ela é independente das outras.
O que não dá é pular a 3 antes da 4 (a chamada em grupo é a de 1-a-1 repetida),
nem levar amigos pra dentro antes da 7.
