# Cinema fullscreen kiosk

## Objetivo

Ao acionar `Tela cheia` no Orbit Cinema, mostrar somente o player de vídeo em toda a área física do monitor. Não podem aparecer barra de título, barra de tarefas do Windows, navegação do Orbit, título do filme ou margens do aplicativo. `Esc` encerra o modo e retorna à tela anterior do catálogo.

## Contexto confirmado

- O conteúdo do Superflix funciona quando incorporado em `iframe`.
- Abrir a URL do player como documento principal mostra `Visualização Externa` e não reproduz o conteúdo.
- O fullscreen CSS do Orbit amplia o painel, mas não garante fullscreen do sistema.
- A versão exibida em `Sobre` representa o cliente web e não confirma a versão instalada do Electron.

## Arquitetura

### Shell de player

O servidor fornece uma rota dedicada, `/cinema-fullscreen`, que renderiza um documento mínimo com fundo preto e um único `iframe`. O iframe ocupa `100vw` por `100vh`, não possui bordas ou margens e mantém `allowFullScreen` e as permissões de mídia necessárias.

A rota aceita somente URLs HTTPS cujo hostname seja `superflixapi.beer` ou `www.superflixapi.beer`. URLs inválidas retornam uma página de erro local e nunca são incorporadas.

### Janela Electron

O preload expõe um comando específico para abrir o shell. O processo principal valida novamente a URL e cria uma `BrowserWindow` exclusiva com:

- `frame: false`;
- `kiosk: true`;
- `fullscreen: true`;
- fundo preto;
- integração Node desativada, isolamento de contexto e sandbox;
- bloqueio de novas janelas e popups.

A janela carrega a rota no servidor do Discord Caseiro, e não a URL externa diretamente. O servidor incorpora o player no iframe. A janela principal só é escondida depois que o shell termina de carregar. Se o carregamento falhar, a janela exclusiva é fechada e a principal permanece visível.

### Retorno

O processo principal intercepta `Esc`, fecha a janela do player, restaura e focaliza a janela principal. O fechamento manual ou erro de carregamento segue o mesmo caminho.

## Fluxo

1. O usuário escolhe um filme ou episódio e aciona `Tela cheia` no Orbit.
2. O cliente envia a URL do player para a ponte Electron.
3. O Electron valida o domínio e monta a URL do shell no servidor atual.
4. A janela kiosk carrega o shell, que incorpora o player em iframe.
5. Após o carregamento, a janela principal é escondida e o player é exibido.
6. `Esc` fecha o player e restaura o catálogo.

No navegador comum, o comportamento permanece no fullscreen padrão do iframe, sem tentar criar uma janela Electron.

## Falhas e segurança

- URL fora da lista permitida: recusar e manter a tela atual.
- Shell indisponível: fechar a janela incompleta e restaurar o app.
- Player externo indisponível: exibir erro dentro do shell com ação para voltar.
- Popup ou anúncio tentando abrir janela: negar no processo principal.
- Uma janela de player já aberta: focalizar a existente em vez de duplicar.

## Atualização e versão

O cliente web e o Electron exibem versões separadas em `Sobre`. A correção será distribuída em um novo release do desktop. Neste computador, o instalador será aplicado e a versão dentro de `app.asar` será conferida depois da instalação.

## Verificação obrigatória

Antes de considerar concluído:

1. Build do cliente e do Electron sem erros.
2. Teste da rota com uma URL válida e rejeição de domínio inválido.
3. Teste automatizado da janela confirmando `isKiosk() === true` e `isFullScreen() === true`.
4. Dimensões da janela iguais às dimensões do monitor ativo.
5. Captura do conteúdo mostrando apenas o player, sem interface do Orbit.
6. Teste de `Esc` restaurando a janela principal.
7. Instalação local da nova versão e conferência da versão empacotada.
8. Publicação do release com instalador, blockmap e `latest.yml` consistentes.

O trabalho só é concluído quando todos esses itens passarem.
