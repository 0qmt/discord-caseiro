# Limites e riscos reais

Nada aqui é motivo para desistir — é para você saber onde o projeto encosta na
parede antes de encostar.

## 1. A malha P2P cresce ao quadrado

Sem SFU, cada pessoa abre uma conexão com **cada** uma das outras:

| Pessoas | Conexões no total | Streams que **cada um** envia |
| --- | --- | --- |
| 2 | 1 | 1 |
| 3 | 3 | 2 |
| 4 | 6 | 3 |
| 5 | 10 | 4 |
| 8 | 28 | 7 |

O gargalo não é o número de conexões, é o **upload de cada participante** — e
internet residencial no Brasil costuma ser bem assimétrica (300 Mbps de download
com 30 Mbps de upload é comum).

Upload necessário por pessoa, aproximado:

| Cenário | Por stream | 4 pessoas | 5 pessoas |
| --- | --- | --- | --- |
| Só áudio (Opus) | ~40 kbps | ~0,12 Mbps | ~0,16 Mbps |
| Vídeo 720p30 | ~1,5 Mbps | ~4,5 Mbps | ~6 Mbps |
| Tela 1080p30 | ~3 Mbps | ~9 Mbps | ~12 Mbps |

**Teto prático:** 4–5 pessoas com vídeo, 8–10 só com áudio. Passando disso, o
caminho é um SFU (mediasoup, LiveKit) — cada um manda **um** stream para o
servidor e o servidor redistribui. Só que aí a carga toda vai pra sua máquina e
pro seu upload, o que é uma troca, não uma solução mágica.

Mitigações baratas, quando chegar a Etapa 4:
- limitar bitrate com `RTCRtpSender.setParameters()` (`maxBitrate`)
- desligar o vídeo de quem não está falando
- `scaleResolutionDownBy` quando tiver mais de 3 pessoas

## 2. TURN é o que come sua banda

Enquanto a conexão é direta (P2P), sua máquina **não vê a mídia** — só o texto
do chat e o signaling, que é tráfego irrisório. Quando o P2P falha e o TURN
entra, o fluxo passa a **entrar e sair** da sua casa:

> Chamada de 4 pessoas, vídeo 720p, **todas** via relay:
> ~1,5 Mbps × 3 streams × 2 sentidos ≈ **9 Mbps sustentados**, ou seja
> **cerca de 4 GB por hora** atravessando a sua conexão.

Três coisas que suavizam isso:

1. **O TURN é reserva, não caminho padrão.** O ICE tenta conexão direta primeiro;
   na prática a maioria dos pares fecha em P2P e o relay atende só quem está
   atrás de CGNAT ou de rede corporativa.
2. **Se sua internet tiver franquia de dados, olhe esse número antes.** Umas
   poucas horas de call relayada por semana já somam dezenas de GB no mês.
3. **Dá para restringir o relay a áudio** e deixar o vídeo cair só no P2P. Uma
   call de voz relayada é irrelevante em banda; a de vídeo é que pesa.

## 3. Sua máquina é o ponto único de falha

Se o PC desliga, cai a energia ou o Windows resolve reiniciar pra atualizar,
ninguém entra em call nem lê o chat até você religar. Isso é o preço do
self-hosted, e vale planejar:

- deixe o serviço subir sozinho no boot (Agendador de Tarefas do Windows, ou
  `systemd` se for Linux)
- desative reinício automático por Windows Update no horário de uso
- desligue a suspensão automática da máquina e a suspensão da placa de rede
- **backup:** `data/app.db` é o projeto inteiro. Uma cópia semanal para outra
  pasta ou pendrive já resolve. (Com WAL ligado, copie os três arquivos:
  `app.db`, `app.db-wal` e `app.db-shm`.)

Um mini PC ou Raspberry Pi 4/5 dedicado resolve melhor que o PC principal: fica
ligado sem atrapalhar, gasta pouca energia e roda coturn nativamente.

## 4. Segurança ao expor pra internet

Detalhe completo na Etapa 7, mas o resumo do que importa:

- **HTTPS não é opcional.** `getUserMedia()` e `getDisplayMedia()` só funcionam
  em contexto seguro. Sem certificado, microfone, câmera e compartilhamento de
  tela simplesmente não ligam fora de `localhost`. Let's Encrypt resolve de
  graça; um túnel do Cloudflare já entrega HTTPS pronto.
- **Abra só o que precisa.** A porta do app e, se usar TURN, 3478/5349 mais a
  faixa UDP de mídia. Nunca deixe RDP (3389) ou SSH (22) abertos pra internet —
  é o primeiro alvo de varredura automatizada.
- **Feche o cadastro** (`ALLOW_REGISTRATION=false`) assim que todo mundo tiver
  conta. Senão qualquer um que descubra o endereço cria usuário.
- **Rate limit no login** ainda não existe — precisa entrar antes de expor.
  Hoje só o envio de mensagem é limitado.
- **Seu IP residencial fica visível** para quem se conectar. Entre amigos, tudo
  bem; é um motivo a mais pra não divulgar o endereço em lugar público. Um túnel
  esconde o IP; port forwarding não.
- **Mantenha atualizado.** `npm audit` de vez em quando e `npm update` nas
  dependências.

## 5. O que já está resolvido

Para não parecer que tudo é problema, o que a Etapa 1 já trata:

- senhas com bcrypt, nunca em texto puro
- token exigido no REST e no WebSocket, com permissão revalidada no servidor a
  cada mensagem — o cliente não é fonte de verdade
- rate limit de mensagens
- resposta de login que não revela quais e-mails existem
- dados de terceiros filtrados antes de sair do servidor
