# Versao remota e atualizacao direcionada

Date: 2026-09-24

## Objetivo

Permitir que a conta exclusiva `pepo` veja, no final do menu de contexto de
cada usuario, quais clientes aquela pessoa esta usando e mande somente os apps
desktop desatualizados reiniciarem para instalar a versao mais recente.

O recurso nao substitui o atualizador do Electron. Ele usa o download,
verificacao de assinatura e instalacao que ja existem, acrescentando apenas a
identificacao da versao conectada e um comando remoto direcionado.

## Autorizacao

A permissao sera vinculada a uma ID exata configurada no servidor pela variavel
`REMOTE_UPDATE_ADMIN_USER_ID`. Cargo, nome de usuario e acesso ao menu nao sao
suficientes.

O servidor valida a ID em toda leitura de versoes e em todo pedido de
atualizacao. Um cliente alterado por outro administrador nao consegue consultar
versoes nem enviar o comando. A capacidade booleana
`remoteClientUpdate` aparece apenas no objeto privado do proprio usuario
autorizado.

## Identificacao dos clientes

Depois de conectar, cada socket envia uma identificacao limitada a:

- plataforma: `desktop`, `android` ou `web`;
- versao instalada;
- tipo de instalacao desktop: instalador com atualizacao automatica ou
  portable;
- disponibilidade das pontes de atualizacao necessarias.

No desktop, a versao vem de `app.getVersion()` pela ponte existente, e nao do
bundle web servido pelo Umbrel. No Android, vem da informacao nativa do app. No
navegador, corresponde a versao do cliente web.

O servidor sanitiza tamanhos e valores, guarda a informacao somente em memoria
por socket e a remove na desconexao. Ela nao entra no banco. Se a mesma conta
estiver aberta em mais de um dispositivo, cada sessao aparece separadamente.

As versoes nao serao incorporadas ao broadcast publico de presenca. O servidor
envia um snapshot e atualizacoes apenas para os sockets da conta autorizada.

## Menu de contexto

Somente `pepo` ve, no final do menu de botao direito de outra pessoa, uma secao
de versoes depois das acoes administrativas.

Cada sessao conectada produz uma linha como:

- `Desktop 0.2.74 - Atualizada`;
- `Desktop 0.2.73 - Desatualizada`;
- `Android 0.2.72`;
- `Web - versao atual`;
- `Versao indisponivel`, para uma sessao antiga que nao se identificou.

A comparacao usa versoes semanticas e a versao do bundle atualmente servido
pelo Umbrel como referencia. Texto invalido nunca e tratado como versao mais
nova.

Para um desktop instalado e desatualizado, a linha acionavel se chama
`Reiniciar para atualizar`. Desktop portable e plataformas sem atualizacao
automatica mostram a versao, mas nao oferecem a acao.

## Comando direcionado

Ao clicar em `Reiniciar para atualizar`, o cliente administrador envia o ID do
usuario e, opcionalmente, os sockets desktop desatualizados mostrados no menu.
O servidor:

1. valida a ID exata do remetente;
2. confirma que os sockets ainda pertencem ao usuario escolhido;
3. seleciona apenas sessoes desktop desatualizadas;
4. emite `app:force-update` somente para esses sockets;
5. responde quantas sessoes receberam o pedido.

Se o usuario abriu outro dispositivo depois de o menu aparecer, ele nao e
incluido por acidente. Se a sessao ja desconectou, o pedido e ignorado com um
aviso claro ao administrador.

## Atualizacao automatica no destinatario

Ao receber `app:force-update`, o cliente desktop grava localmente uma intencao
temporaria de atualizacao forcada. Isso permite que o fluxo sobreviva ao
primeiro reinicio e funciona inclusive quando a interface web nova esta rodando
dentro de uma versao desktop anterior.

O fluxo e:

1. consultar o estado do atualizador existente;
2. se a atualizacao ja estiver baixada, chamar `quitAndInstall` pela ponte
   existente;
3. se estiver verificando ou baixando, aguardar e instalar assim que ficar
   pronta;
4. se o app ainda nao tiver consultado a release nova, reiniciar o desktop uma
   unica vez, preservando a intencao local, para disparar a verificacao normal
   da inicializacao;
5. depois do reinicio, aguardar o download e instalar automaticamente.

O comando e deliberadamente forcado: nao pede confirmacao e pode interromper
uma call. O mecanismo atual de retomada de call continua registrando o canal e
tenta reconectar depois da atualizacao.

A intencao forcada tem prazo e contador de tentativas. Ela e apagada depois da
instalacao, quando nenhuma atualizacao existe ou quando o limite e atingido,
evitando ciclos infinitos de reinicio.

## Compatibilidade e falhas

- Clientes que ainda nao enviam identificacao aparecem com versao
  indisponivel e nao recebem uma acao insegura baseada em suposicao.
- Desktop portable nunca executa instalacao automatica.
- Web e Android sao apenas informativos nesta primeira versao.
- Se o download ou a verificacao falhar, o app nao entra em loop; mantem a
  versao atual e o administrador recebe apenas a confirmacao de entrega, nao
  uma falsa confirmacao de instalacao.
- O servidor nao aceita comandos globais por esta funcionalidade.
- Um usuario nao pode mandar o comando para si proprio pelo menu de membros.

## Componentes afetados

- Ponte desktop: reutiliza versao, tipo de instalacao, estado do atualizador e
  reinicio para instalar.
- Cliente: identifica a sessao, mantem o snapshot administrativo, monta as
  linhas do menu e executa a intencao forcada no destinatario.
- Servidor em tempo real: sanitiza e guarda metadados por socket, entrega o
  snapshot privado e valida o comando direcionado.
- Serializacao do proprio usuario: expoe a capacidade
  `remoteClientUpdate` somente para a conta configurada.
- Configuracao de producao: define `REMOTE_UPDATE_ADMIN_USER_ID` com a ID da
  conta `pepo`.

## Validacao

- Teste unitario de comparacao semantica, incluindo versao igual, anterior,
  posterior e invalida.
- Teste de sanitizacao da identificacao enviada pelo cliente.
- Teste de autorizacao: `pepo` recebe snapshot e consegue enviar o comando;
  outro dono/admin nao recebe dados nem consegue forjar o evento.
- Teste com duas sessoes da mesma conta, garantindo que somente os sockets
  selecionados e desatualizados recebem o comando.
- Teste do menu para desktop atualizado, desatualizado, portable, Android, web
  e versao indisponivel.
- Teste da intencao persistente: atualizacao pronta instala imediatamente;
  download pendente espera; estado ocioso reinicia no maximo uma vez; falha ou
  prazo encerrado limpa a intencao.
- Build de producao do cliente e do desktop.
- Smoke com duas contas: `pepo` ve a versao e força a atualizacao; outro admin
  nao ve nem aciona; o destinatario volta na versao nova.

## Fora de escopo

- Manter historico de versoes de usuarios offline.
- Atualizar Android remotamente sem interacao.
- Instalar atualizacoes em versoes portable.
- Exibir versoes para todos os administradores.
- Reiniciar todos os usuarios com essa acao direcionada.
