# Etapa 7 — Expor o servidor para a internet

> **Status: não implementado, de propósito.**
> Este documento é só o mapa da decisão. Nada aqui foi configurado no projeto.
> Peça quando as etapas 1 a 6 estiverem funcionando localmente.

Esta é a etapa em que o projeto deixa de ser "só você testando" e passa a
depender de infraestrutura de verdade. Até aqui, tudo funciona sem tocar no
roteador.

## As duas abordagens

### A) DNS dinâmico + redirecionamento de portas

Você aponta um nome (`meuservidor.duckdns.org`) para o IP da sua casa, que muda
de tempos em tempos, e abre portas no roteador para a sua máquina.

**A favor**
- Controle total, nenhum terceiro no caminho dos dados.
- É a **única** das duas que funciona bem para o TURN: coturn precisa de UDP, e
  os túneis HTTP não passam UDP arbitrário.
- Custo zero (DuckDNS, No-IP têm plano grátis).

**Contra**
- Exige mexer no roteador (e alguns de operadora não deixam).
- **Se sua operadora usa CGNAT, simplesmente não funciona** — você não tem IP
  público próprio. É comum em fibra residencial no Brasil; dá pra pedir IP
  público à operadora, às vezes de graça, às vezes pago.
- Seu IP residencial fica exposto para quem conectar.
- HTTPS é por sua conta (Let's Encrypt via Caddy resolve quase sozinho).

### B) Túnel (Cloudflare Tunnel ou Tailscale)

Sua máquina abre uma conexão **de dentro pra fora** e o tráfego chega por ela.

**Cloudflare Tunnel**
- Atravessa CGNAT, não abre porta nenhuma, HTTPS já vem pronto, esconde seu IP.
- Mas só passa HTTP/WebSocket: **serve para o app, não para o TURN**. Se algum
  amigo precisar de relay, o coturn continua precisando de porta aberta ou de um
  segundo caminho.
- Precisa de um domínio na Cloudflare (uns 10–15 dólares por ano, ou um domínio
  grátis que aceite os nameservers deles).

**Tailscale**
- VPN em malha: cada amigo instala o Tailscale e enxerga sua máquina como se
  estivesse na mesma rede local.
- Atravessa CGNAT, criptografado, nada exposto pra internet aberta, plano grátis
  cobre bem mais que um grupo de amigos.
- Como todo mundo fica numa "LAN virtual", o WebRTC costuma fechar direto e o
  **TURN vira quase desnecessário**.
- Contra: cada amigo precisa instalar e ligar o Tailscale — não é só abrir um
  link no navegador.

## Recomendação para o seu caso

Grupo pequeno, uso doméstico, custo zero, sem querer mexer no roteador:

1. **Comece pelo Tailscale.** É o menor caminho até "funcionou": nada aberto pra
   internet, funciona mesmo com CGNAT, resolve o problema do TURN de brinde e
   dispensa certificado. O único custo é pedir para cada amigo instalar um app.
2. **Se implicarem com instalar o Tailscale**, vá de Cloudflare Tunnel para o
   app (link no navegador, HTTPS pronto) e resolva o TURN separado — ou aceite
   ficar sem TURN e ver quantos pares fecham em P2P direto (na prática, a
   maioria).
3. **Port forwarding só se** você tiver IP público de verdade, quiser o controle
   e não se importar de manter certificado e regras de firewall.

## Checklist de antes de abrir (independente da abordagem)

- [ ] `ALLOW_REGISTRATION=false` depois que todos criarem conta
- [ ] rate limit no login (ainda não implementado)
- [ ] senha forte para todo mundo, principalmente a do dono
- [ ] HTTPS funcionando — sem ele, microfone, câmera e tela não ligam
- [ ] `npm run build` no cliente, para o backend servir tudo numa porta só
- [ ] backup automático de `data/app.db`
- [ ] o serviço sobe sozinho quando a máquina liga
- [ ] Windows Update não reinicia a máquina no horário de uso
- [ ] `npm audit` limpo
- [ ] nenhuma porta administrativa (RDP 3389, SSH 22) aberta pra internet

## O que muda no código

Pouco, e é bom que seja pouco:

- `CLIENT_ORIGIN` no `.env` passa a incluir o endereço público
- os `iceServers` passam a vir do backend (rota nova), com o TURN e credenciais
  temporárias
- se houver proxy reverso na frente, `app.set('trust proxy', 1)` para o rate
  limit por IP funcionar direito
- `npm run build` no cliente — o backend já detecta `client/dist` e serve
  sozinho, isso já está pronto
