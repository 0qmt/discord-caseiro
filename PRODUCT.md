# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Um grupo privado de amigos usa o Discord Caseiro diariamente pelo aplicativo de desktop no Windows e, quando necessario, pelo navegador. O dono administra o servidor domestico; os demais participantes entram por convite e precisam conversar, entrar em chamadas, compartilhar tela e assistir conteudo juntos sem conhecer a infraestrutura.

## Product Purpose

O Discord Caseiro oferece comunicacao privada em tempo real hospedada no servidor do proprio usuario. Sucesso significa que texto, voz, video, compartilhamento de tela, presenca, notificacoes e sessoes de Cinema sejam previsiveis, sincronizados e simples o bastante para uso diario.

## Positioning

Um cliente de comunicacao para um grupo conhecido cuja API, banco, signaling e regras de comunidade rodam no servidor domestico do proprietario, com controle direto sobre dados, disponibilidade e evolucao do produto.

## Operating Context

- Backend executado em um servidor com UmbrelOS.
- Cliente React/Vite servido pelo backend e empacotado em Electron para Windows.
- Conversas organizadas em servidores, categorias, canais de texto, canais de voz e mensagens diretas.
- Uso frequente em segundo plano durante jogos e chamadas, tornando presenca, audio, badges e notificacoes partes essenciais do fluxo.
- Cinema pode ser usado individualmente ou em sessoes sincronizadas dentro de uma chamada.

## Capabilities and Constraints

- Contas, perfis, status, servidores, convites, cargos, permissoes e moderacao.
- Chat persistente em tempo real com historico, paginacao, replies, edicao, exclusao, fixacao, busca, anexos, GIFs, links, reacoes, encaminhamento, denuncia, comandos, digitacao, nao lidas e mencoes.
- Chamadas com audio, camera, compartilhamento de tela, controles de participante, grades, convites e reconexao.
- Sessoes de Cinema independentes e sincronizadas, votacao para alteracoes de reproducao e player fullscreen nativo.
- Orbit e a unica interface oficial. A interface classica foi descontinuada.
- O codigo deve preservar compatibilidade com mensagens e instalacoes existentes e nao pode manter implementacoes concorrentes do chat.
- Stack existente: React 19, Vite, Node.js, Express, Socket.IO, SQLite e Electron.
- O catalogo e a reproducao do Cinema dependem de uma API externa configurada pelo projeto.

## Brand Commitments

- Nome do produto: Discord Caseiro.
- Nome da interface oficial: Orbit.
- Voz direta, cotidiana e em portugues brasileiro.
- Tema escuro e logica de navegacao familiar a usuarios de clientes desktop de chat.
- A interface deve parecer um produto desktop real, denso, funcional e maduro; nao um dashboard SaaS, template generico ou composicao gerada por IA.

## Evidence on Hand

- Implementacao funcional em `client/`, `server/` e `desktop/`.
- Arquitetura documentada em `docs/ARQUITETURA.md` e demais documentos de `docs/`.
- Especificacao aprovada em `docs/superpowers/specs/2026-09-02-orbit-chat-redesign-design.md`.
- Capturas reais fornecidas pelo usuario mostram o shell atual, o fluxo de chat, chamadas e Cinema.
- Nao ha testemunhos, metricas comerciais ou alegacoes publicas a serem exibidas.

## Product Principles

1. Funcionalidade e previsibilidade vem antes de decoracao.
2. Uma unica fonte de verdade para cada comportamento evita divergencias entre telas.
3. Privacidade e controle local devem continuar compreensiveis e operaveis pelo dono.
4. O cliente deve desaparecer durante a conversa: densidade, familiaridade e feedback imediato sustentam o uso diario.
5. Atualizacoes devem preservar chamadas, mensagens, dados e compatibilidade dos amigos.

## Accessibility & Inclusion

A interface deve ser navegavel por teclado, manter foco visivel, usar HTML semantico, labels reais, contraste adequado e estados que nao dependam somente de cor. Reducao de movimento deve ser respeitada. Layouts web precisam continuar utilizaveis em desktop, tablet e smartphone.

