# Discordia Android - Design e inventario de paridade

Data: 2026-09-08

## 1. Objetivo

Criar uma versao Android instalavel por APK que preserve o produto Discordia
existente, reutilize o cliente React e o servidor no Umbrel e nao introduza um
segundo backend ou protocolo paralelo.

O documento e simultaneamente:

- inventario funcional da versao atual;
- matriz de paridade entre navegador, Electron e Android;
- desenho da arquitetura Android;
- ordem de implementacao e validacao;
- checklist permanente para evitar funcoes esquecidas.

Decisoes aprovadas:

- Android e a primeira plataforma movel;
- o aplicativo sera distribuido inicialmente como APK privado;
- todo o desenvolvimento e build devem funcionar no Windows;
- React/Vite e o nucleo compartilhado;
- Capacitor 8 e o container Android;
- Android 8.0 (API 26) e o minimo inicial;
- recursos modernos usam deteccao de capacidade e degradacao explicita;
- Electron, GitHub Releases e NSIS continuam exclusivos do desktop;
- o servidor Node/Express, Socket.IO, SQLite, STUN e TURN continua no Umbrel.

## 2. Estado atual do produto

### 2.1 Componentes de execucao

1. `client/`: React 19 e Vite. Contem a interface e a maior parte das regras
   de interacao do usuario.
2. `server/`: Node 22, Express 5, Socket.IO e `node:sqlite`. Serve API, arquivos,
   cliente compilado, sinalizacao em tempo real e sinalizacao WebRTC.
3. `desktop/`: Electron. Carrega o cliente remoto e oferece integracoes do
   Windows, tray, captura de tela/audio, notificacoes, deteccao de jogos,
   bloqueio de anuncios e atualizacao por `electron-updater`/NSIS.
4. `deploy/coturn/`: relay TURN usado quando conexao WebRTC P2P direta falha.
5. `deploy/duckdns/`: atualiza o endereco publico do servidor.
6. `landing/`: pagina de distribuicao/download; nao e parte da interface do
   aplicativo.

### 2.2 Transporte e persistencia

- HTTP REST para leitura, configuracao e uploads.
- Socket.IO autenticado para mensagens, presenca, chamadas e cinema.
- WebRTC P2P para microfone, camera, tela e audio da transmissao.
- STUN para descoberta de rota e coturn como fallback.
- JWT com validade configurada para 30 dias.
- SQLite persistente no volume do Umbrel.
- Uploads persistentes servidos por `/uploads`.

Tabelas atuais: `users`, `guilds`, `guild_members`, `channels`, `messages`,
`invites`, `dm_channels`, `dm_messages`, `categories`, `roles`, `member_roles`,
`channel_overwrites`, `message_reactions`, `user_notes`,
`notification_settings`, `read_state`, `message_mentions`, `guild_bans`,
`audit_log` e `password_resets`.

## 3. Inventario funcional completo

### 3.1 Conta, sessao e perfil

- cadastro condicionado pela configuracao do servidor;
- login por e-mail/senha e restauracao de sessao JWT;
- consulta da propria conta;
- troca de senha e recuperacao por e-mail quando SMTP esta configurado;
- nome, identificador publico, bio e status;
- avatar com recorte e exclusao;
- banner com recorte e exclusao;
- tema de perfil com duas cores e posicao do gradiente;
- cartao rapido de perfil e editor completo;
- nota privada sobre outro usuario;
- presenca online/offline e atividade manual/automatica.

### 3.2 Servidores, canais e organizacao

- listar, criar, abrir, editar e excluir servidor;
- icone, recorte do icone, nome e descricao;
- canais de texto e voz;
- categorias;
- criar, editar, excluir e reordenar canais/categorias;
- drag and drop de organizacao no desktop;
- topico do canal;
- convites: criar, listar, revogar, visualizar e entrar;
- lista de membros online/offline;
- apelido por servidor;
- mover membro entre canais de voz.

### 3.3 Cargos, permissoes e moderacao

- cargo base `@everyone` e cargos personalizados;
- criar, editar, ordenar e excluir cargos;
- cor e atribuicao/remocao de cargo;
- sobrescritas de permissao por canal;
- promover membro;
- expulsar, banir, desbanir e timeout;
- lista de banidos e auditoria;
- relatorio de erro;
- administracao e recarga do servidor.

Permissoes existentes:

- ver canal;
- enviar mensagem;
- gerenciar mensagens;
- anexar arquivos;
- mencionar todos;
- falar;
- ouvir;
- transmitir;
- silenciar membros;
- ensurdecer membros;
- mover membros;
- gerenciar canais;
- gerenciar cargos;
- gerenciar servidor;
- expulsar;
- banir;
- criar convite;
- gerenciar apelidos;
- administrador.

O cliente esconde acoes sem permissao, mas o servidor repete a autorizacao.
Essa regra deve continuar no Android.

### 3.4 Mensagens de canal

- historico paginado;
- envio otimista com `nonce`;
- resposta a mensagem;
- edicao e exclusao;
- fixar/desafixar e listar fixadas;
- reacoes com emoji;
- mencoes de usuario e notificacao de mencao;
- indicador de digitacao;
- mensagens nao lidas e marcador de leitura;
- busca no canal;
- encaminhamento;
- menu contextual;
- comandos locais;
- links clicaveis e preview de URL;
- copia de texto e imagem;
- anexos de imagem e arquivo;
- lightbox para imagens;
- seletor e busca de GIF quando Giphy esta configurado;
- notificacoes por servidor, canal e mensagem direta.

### 3.5 Mensagens diretas

- listar conversas e contatos;
- abrir/criar conversa;
- historico de mensagens;
- envio de texto e anexos;
- resposta e edicao conforme suporte atual;
- indicador de presenca;
- notificacao e marcacao de leitura.

### 3.6 Voz, video e transmissao

- entrar e sair de canal de voz;
- estado sincronizado dos participantes;
- microfone ligado/desligado;
- ensurdecimento local;
- push-to-talk;
- atividade de voz;
- selecao de entrada e saida de audio;
- camera ligada/desligada;
- transmissao de tela;
- transmissao do audio do sistema;
- assistir ou parar de assistir uma transmissao;
- volume individual de participante;
- volume individual da transmissao;
- mute local de participante;
- qualidade da tela: resolucao, FPS e modo nativo;
- tela cheia e picture-in-picture quando suportados;
- moderacao de mute/deafen;
- expulsao direta ou por votacao;
- convite para chamada, aceite, recusa, cancelamento e timeout;
- reconexao WebRTC e diagnostico de ICE;
- metricas da transmissao e estado de conexao.

Tipos de midia sinalizados hoje: `audio`, `camera`, `screen` e `screenAudio`.

### 3.7 Cinema e Watch Together

- home de cinema;
- busca e catalogo;
- consulta de episodios e player;
- iniciar, entrar, sair e encerrar sessao;
- sincronizar play, pause e posicao;
- proposta e votacao de controle;
- player em tela cheia;
- integracao desktop com janela kiosk;
- bloqueio de anuncios no Electron por Ghostery.

### 3.8 Configuracoes e experiencia

- abas de conta, voz/video, notificacoes, temas, servidor e sobre;
- tema global e tema de perfil;
- configuracao de microfone e saida;
- preferencias de notificacao;
- versao e horario do build;
- estado de update no desktop;
- notificacoes nativas e sons de chamada/mencao;
- layout Orbit responsivo;
- drawer de canais abaixo de 620 px;
- painel de membros adaptativo;
- suporte a toque sem depender exclusivamente de hover;
- respeito a `prefers-reduced-motion`.

### 3.9 Recursos exclusivos do Electron/Windows

- tray e esconder ao fechar no X;
- iniciar com o Windows;
- instancia unica e reabrir janela existente;
- notificacoes nativas pelo processo principal;
- reproducao de sons pelo processo principal;
- seletor de tela/janela com `desktopCapturer`;
- captura de audio do sistema;
- tela cheia nativa e janela kiosk;
- deteccao de jogo/processo para atividade;
- bloqueio de anuncios na sessao Electron;
- configuracao do endereco do servidor;
- splash com verificacao de atualizacao;
- `electron-updater`, GitHub Releases, cache e NSIS;
- instalacao normal/portable e logs persistentes do updater.

Esses itens nao podem ser copiados literalmente para Android.

## 4. Matriz de paridade Android

### 4.1 Reutilizacao direta

Reutilizam componentes, API e eventos atuais, com ajustes de layout/toque:

- autenticacao e perfil;
- servidores, categorias, canais, membros, cargos e permissoes;
- mensagens de canal e DMs;
- reacoes, mencoes, pins, busca, respostas e edicao;
- GIFs, previews e anexos depois de integrar o picker nativo;
- preferencias, temas e cinema;
- presenca e sinalizacao Socket.IO;
- regras de moderacao e auditoria.

### 4.2 Reutilizacao com adaptador de plataforma

- armazenamento de sessao;
- notificacoes;
- clipboard e compartilhamento;
- camera, galeria e arquivos;
- links externos/deep links;
- teclado virtual e safe areas;
- status bar, orientacao, voltar e lifecycle;
- audio input/output e Bluetooth;
- fullscreen e picture-in-picture;
- atualizacao e informacao de versao;
- bloqueio de anuncios no cinema.

### 4.3 Implementacao nativa obrigatoria

- push por FCM e registro de device token no servidor;
- foreground service durante chamada/transmissao;
- audio focus e audio routing;
- integracao com notificacao persistente de chamada;
- captura de tela por `MediaProjection`;
- captura de audio reproduzido quando permitida pelo Android e pelo app fonte;
- instalacao de atualizacao APK com confirmacao do sistema;
- armazenamento de credenciais pelo Android Keystore;
- eventual integracao `ConnectionService` para chamadas em background.

### 4.4 Sem equivalente ou com limitacao explicita

- tray: substituido por notificacao/foreground service;
- iniciar com Windows: nao se aplica;
- deteccao de jogos/processos: bloqueada pelo sandbox Android;
- escolher qualquer janela do sistema: Android compartilha tela ou app conforme
  suporte da versao, sempre com dialogo do sistema;
- audio do sistema: apps com DRM ou que proibem captura podem ficar mudos;
- update silencioso: usuario precisa autorizar a instalacao fora da Play Store;
- adblock do Electron: precisa de interceptacao propria no WebView e nunca deve
  ser prometido como universal para conteudo externo/DRM.

## 5. Arquitetura proposta

### 5.1 Estrutura de codigo

Adicionar uma plataforma Android ao cliente, sem duplicar o aplicativo:

```text
client/
  src/
    platform/
      index.js
      web.js
      electron.js
      android.js
    ...componentes e regras existentes
  android/                 projeto Capacitor/Gradle
  capacitor.config.*
```

`platform/index.js` seleciona o adaptador por capacidade, nunca por user-agent.
Componentes chamam contratos pequenos, por exemplo:

- `platform.version.get()`;
- `platform.notifications.request()`;
- `platform.secureStorage.get/set()`;
- `platform.media.pickFile()`;
- `platform.call.startForeground()`;
- `platform.screenShare.start()`;
- `platform.updates.check()`.

`window.appDesktop` continua encapsulado pelo adaptador Electron. Nao devem
surgir condicionais de Android espalhadas por `App.jsx`.

### 5.2 Configuracao Android

- package id: `com.discordcaseiro.app`;
- `minSdk`: 26 (Android 8.0);
- `targetSdk`: a API estavel mais recente suportada pelo toolchain escolhido;
- orientacao adaptativa, com video/cinema podendo entrar em landscape;
- APK universal na primeira fase para simplificar testes;
- splits por ABI apenas depois da estabilidade;
- build `debug` para desenvolvimento e `release` assinado para amigos;
- WebView do sistema atualizado como requisito operacional.

### 5.3 Chave de assinatura

Gerar um keystore de release unico. Ele nunca entra no Git e deve ter backup
criptografado em pelo menos dois locais. Senhas entram por variaveis locais ou
secret store do CI. Toda atualizacao precisa da mesma chave.

Perder a chave significa nao poder atualizar os APKs ja instalados. Expor a
chave permite que terceiros distribuam atualizacoes maliciosas.

### 5.4 Endpoint e seguranca

O app deve usar somente `https://` e `wss://` com certificado valido. A URL do
servidor fica em configuracao de build ou onboarding controlado; URLs digitadas
pelo usuario precisam ser normalizadas e validadas.

O token JWT sai do `localStorage` no Android e vai para armazenamento protegido
pelo Android Keystore. Dados nao sensiveis podem permanecer em Preferences.

O servidor deve adicionar:

- cadastro/revogacao de device tokens FCM;
- endpoint autenticado de capacidades/configuracao mobile;
- endpoint de metadados de update APK;
- hospedagem protegida do APK e seu hash;
- limites de taxa e validacao de payload para novos endpoints.

Nenhum segredo de assinatura, FCM ou administracao deve entrar no bundle web.

## 6. Mensagens, arquivos e navegacao movel

- Long press abre os menus hoje acionados por botao direito.
- Acoes de mensagem continuam acessiveis sem hover.
- Drag and drop ganha alternativa por menu: mover acima/abaixo/para categoria.
- O seletor Android fornece foto, camera, video e documento.
- Upload usa URI/stream nativo, preservando nome, MIME e limite do servidor.
- Imagens grandes sao redimensionadas com opcao de original quando apropriado.
- Botao Voltar fecha, nesta ordem: menu, lightbox, modal, drawer, tela interna;
  somente depois permite sair/minimizar o app.
- Teclado nao pode cobrir compositor, mencoes ou botao de envio.
- Insets de status/navigation bar e recortes da tela usam safe areas.

## 7. Voz e video

### 7.1 Primeira etapa: foreground

Reutilizar a sinalizacao e a maquina WebRTC atuais no WebView:

- `voice:join/leave/signal/state` permanecem inalterados;
- mesmas credenciais STUN/TURN;
- mesmas quatro midias logicas;
- permissoes de microfone/camera solicitadas no contexto da acao;
- rota de audio inicia em comunicacao, com escolha speaker/earpiece/Bluetooth;
- volume por participante e volume da transmissao continuam locais.

Testes obrigatorios incluem aparelhos de fabricantes diferentes e redes Wi-Fi,
4G/5G, CGNAT e troca de rede durante a chamada.

### 7.2 Background e tela bloqueada

WebView sozinho nao e garantia de chamada continua. Adicionar foreground
service com notificacao persistente e controles de sair/mute. Depois validar:

- tela apagada;
- app em segundo plano;
- economia de bateria;
- chamada telefonica recebida;
- desconexao/reconexao de Bluetooth;
- mudanca entre Wi-Fi e dados moveis;
- processo recriado pelo Android.

Se testes mostrarem suspensao do WebRTC JavaScript, a midia deve migrar para uma
ponte nativa libwebrtc sem alterar os eventos de sinalizacao do servidor.

## 8. Compartilhamento de tela e audio

O Android usa `MediaProjection`. Fluxo:

1. usuario toca Compartilhar tela;
2. Android exibe permissao oficial de captura;
3. app inicia foreground service `mediaProjection`;
4. plugin nativo entrega video ao sender WebRTC;
5. quando permitido, AudioPlaybackCapture entrega audio como `screenAudio`;
6. notificacao permite parar a transmissao;
7. revogacao do sistema encerra tracks e sincroniza `voice:state`.

O app nunca deve iniciar captura silenciosa. Audio de DRM, chamada telefonica
ou aplicativo que proibe captura nao e capturavel; a UI deve mostrar
`audio indisponivel para esta fonte`, e nao fingir sucesso.

## 9. Notificacoes e chamadas recebidas

Socket.IO continua suficiente enquanto o app esta visivel. Fora dele:

1. servidor grava device token por usuario/dispositivo;
2. mensagem, mencao ou convite relevante gera push FCM;
3. payload contem somente IDs e texto minimo, sem JWT;
4. toque abre diretamente servidor/canal/DM/chamada;
5. app busca o conteudo autenticado no servidor;
6. preferencia por servidor/canal e respeitada antes do envio.

Android 13+ exige permissao de notificacao em runtime. A solicitacao deve
ocorrer apos explicar o beneficio, nao no primeiro frame do app.

## 10. Atualizacao do APK

Nao reutilizar `electron-updater`. Ele permanece exclusivo do desktop.

Metadado sugerido no Umbrel:

```json
{
  "versionName": "0.3.0",
  "versionCode": 30000,
  "minSdk": 26,
  "url": "https://.../discordia-0.3.0.apk",
  "sha256": "...",
  "size": 12345678,
  "mandatory": false
}
```

Fluxo:

1. consultar no boot e periodicamente com timeout;
2. comparar `versionCode` inteiro, nao texto de versao;
3. baixar em armazenamento privado com retomada quando suportada;
4. validar tamanho e SHA-256;
5. verificar que o APK e instalavel e assinado pela chave esperada;
6. pedir autorizacao para instalar apps desta fonte quando necessario;
7. abrir a confirmacao oficial do Android;
8. no proximo boot confirmar `versionCode` esperado e limpar transicao.

Falha de rede nunca bloqueia indefinidamente a abertura. Update obrigatorio nao
entra na primeira versao. O APK anterior fica disponivel para diagnostico, mas
downgrade Android normalmente exige desinstalacao e pode apagar dados locais.

## 11. Cinema, fullscreen e anuncios

- catalogo e sincronizacao sao reutilizados;
- player precisa testar codecs suportados pelo WebView Android;
- fullscreen usa orientacao e system UI Android;
- PiP e implementado apenas em aparelhos compativeis;
- links externos abrem em navegador/controlador confiavel;
- bloqueio de anuncios sera um modulo Android separado, baseado em interceptacao
  de requests e lista versionada;
- o modulo deve ter telemetria local de requests bloqueados e fallback seguro;
- nao ha garantia tecnica de bloquear todo anuncio de pagina externa, iframe,
  video inserido no mesmo fluxo ou conteudo protegido;
- mudancas no provedor de cinema exigem novo teste funcional.

## 12. Fases de entrega

### Fase 0 - Fundacao

- instalar toolchain Android/Java;
- adicionar Capacitor sem mudar Electron;
- criar adaptadores de plataforma;
- gerar APK debug;
- configurar HTTPS/WSS e ambiente;
- instalar em dois aparelhos;
- configurar keystore release e backup.

### Fase 1 - Paridade de texto

- conta/perfil;
- servidores/canais/categorias;
- mensagens/DMs/reacoes/mencoes;
- anexos, camera, galeria e GIFs;
- cargos/permissoes/moderacao;
- navegacao touch, teclado, safe areas e botao Voltar.

### Fase 2 - Tempo real e notificacoes

- presenca e reconexao;
- FCM e deep links;
- contadores/nao lidas;
- voz e video em foreground;
- audio route, Bluetooth, PTT e volumes.

### Fase 3 - Midia avancada

- foreground service;
- chamada em background/tela bloqueada;
- assistir transmissao;
- compartilhar tela via MediaProjection;
- audio permitido via AudioPlaybackCapture;
- fullscreen, orientacao e PiP;
- cinema e sincronizacao.

### Fase 4 - Distribuicao e endurecimento

- APK release assinado;
- manifest/hash/update assistido;
- matriz de aparelhos e versoes;
- testes de rede e bateria;
- logs exportaveis com redacao de dados sensiveis;
- politica de privacidade e permissoes;
- plano opcional para Google Play/AAB.

## 13. Estrategia de testes

### 13.1 Matriz minima

- Android 8/9: aparelho ou emulador de compatibilidade;
- Android 11/12: comportamento intermediario;
- Android 13: permissao de notificacao;
- Android 14/15+: foreground services e MediaProjection;
- pelo menos Samsung, Motorola/Xiaomi e Android proximo do puro;
- tela pequena, tela grande, recorte e navegacao por gestos;
- Wi-Fi local, Wi-Fi externo e dados moveis.

### 13.2 Fluxos obrigatorios

- primeira instalacao e login;
- restauracao da sessao e logout;
- cada acao de mensagem e DM;
- upload de foto, camera, GIF e documento;
- permissoes de cargo negadas e permitidas;
- push com app aberto, em background e encerrado;
- voz entre Android/Android e Android/desktop;
- Bluetooth, speaker, fone com fio e troca de rota;
- camera frontal/traseira e rotacao;
- screen share com e sem audio capturavel;
- receber transmissao com volume local;
- TURN obrigatorio em rede restrita;
- troca Wi-Fi/dados e reconexao;
- cinema sincronizado;
- update valido, offline, hash invalido e assinatura divergente;
- reinstalacao por cima preservando sessao/configuracao.

### 13.3 Criterio de paridade

Cada item da secao 3 deve terminar em um destes estados documentados:

- `PARIDADE`: mesmo resultado funcional;
- `ADAPTADO`: experiencia nativa equivalente;
- `LIMITADO PELO SO`: limitacao comprovada e comunicada;
- `NAO IMPLEMENTADO`: impede declarar a versao completa.

Nenhum item pode desaparecer silenciosamente.

## 14. Observabilidade e privacidade

- log circular local por sessao, rede, Socket.IO, ICE e plugins nativos;
- nunca registrar JWT, senha, segredo TURN, token FCM completo ou conteudo de
  mensagem por padrao;
- tela de diagnostico permite exportar pacote sanitizado;
- IDs podem ser truncados ou correlacionados por hash local;
- erros de permissao distinguem negado, negado permanentemente e indisponivel;
- versao do cliente, versionCode, WebView, Android, fabricante e modelo entram
  no diagnostico;
- eventos de audio informam tracks, bytes e energia sem gravar audio.

## 15. Riscos conhecidos

1. O componente React principal concentra muito estado. A camada de plataforma
   deve ser extraida aos poucos sem reescrever o produto.
2. WebRTC em WebView pode ser suspenso em background; foreground service sera
   validado cedo e libwebrtc nativo permanece como plano de contingencia.
3. Audio da tela depende da politica do aplicativo fonte.
4. Fabricantes Android alteram gestao de bateria e Bluetooth.
5. APK fora da loja exige permissao de fonte desconhecida e manutencao da chave.
6. Push exige FCM e novos dados por dispositivo no servidor.
7. Adblock do Electron nao transfere automaticamente para Android.
8. Android antigo amplia a matriz de testes e pode limitar codecs/performance.
9. O servidor publico e TURN precisam continuar acessiveis e seguros por TLS.
10. Segredos presentes em configuracoes de infraestrutura devem ser rotacionados
    e movidos para arquivos de ambiente antes de publicar o repositorio.

## 16. Itens deliberadamente fora da primeira implementacao

- iOS/IPA;
- publicacao na Google Play;
- update silencioso;
- update obrigatorio;
- deteccao de jogo/processo no Android;
- reescrita em React Native;
- segundo backend;
- protocolo de voz paralelo;
- redesign visual completo.

## 17. Definicao de pronto

A versao Android completa so e aprovada quando:

- APK release instala e atualiza com a mesma chave;
- funcoes da secao 3 estao classificadas e testadas;
- nenhuma permissao e solicitada sem contexto;
- texto, DM, perfil e moderacao mantem os mesmos dados do desktop;
- voz Android/desktop funciona em redes diferentes com TURN;
- chamada sobrevive aos cenarios de lifecycle aprovados;
- transmissao de tela funciona e informa honestamente a disponibilidade do audio;
- push abre a conversa correta;
- falhas de rede nao prendem o splash;
- logs permitem diagnosticar midia sem expor segredos;
- pelo menos tres familias de aparelhos passam pela matriz principal.
