# Sirene exclusiva em convites de chamada

Date: 2026-09-23

## Objetivo

Permitir que uma unica conta autorizada envie convites de chamada com uma
sirene diferente do toque padrao. O recurso reutiliza o convite de chamada
existente e nao cria uma segunda forma de chamar, entrar ou responder.

O arquivo de origem e `D:\João\Downloads\dog-siren.mp3`. Ele possui cerca de
5,15 segundos e sera incorporado ao aplicativo de desktop; o computador de
quem recebe nao depende desse caminho local.

## Autorizacao

A autorizacao e vinculada a ID exata da conta do dono, configurada no servidor.
Nome de usuario e cargo de administrador nao sao suficientes. A ID nao deve ser
hardcoded no cliente.

O servidor e a fonte de verdade. Mesmo que outro usuario altere o cliente e
envie manualmente o campo de sirene, o servidor remove a solicitacao se a conta
nao for a autorizada.

O cliente recebe apenas uma capacidade booleana indicando se a conta atual
pode usar a sirene. Somente nesse caso o checkbox aparece nas configuracoes.

## Configuracao do remetente

Em `Configuracoes -> Notificacoes`, a conta autorizada ve o checkbox:

`Usar sirene especial ao chamar para call`

A opcao inicia desativada e e guardada localmente no dispositivo. Ativar em um
computador nao ativa automaticamente em outro. Usuarios sem a capacidade nao
veem o controle e nao conseguem habilita-lo por API.

O checkbox define o proximo comportamento dos convites enviados por essa conta;
nao toca nenhum som no computador do remetente e nao altera convites ja abertos.

## Fluxo do convite

Ao clicar no botao de chamada existente, o cliente envia o mesmo evento
`voice:convidar`, acrescentando apenas a intencao de usar a sirene quando o
checkbox estiver ativo.

O servidor valida, nesta ordem:

1. o remetente esta em uma chamada;
2. o destinatario pertence ao mesmo servidor;
3. nao existe outro convite pendente para o destinatario;
4. para escolher a sirene, a conta remetente corresponde a ID exclusiva
   configurada.

As tres primeiras regras continuam decidindo se o convite e valido. A quarta
decide apenas o som: quando ela passa, o payload `voice:convite` informa o tipo
especial; quando falha, a solicitacao de sirene e descartada e o convite segue
com o toque normal.

O destinatario continua vendo o mesmo banner e as mesmas acoes de aceitar e
recusar. A mudanca e apenas o som.

## Reproducao no computador do destinatario

O MP3 sera copiado para os recursos empacotados do aplicativo Electron. A ponte
do desktop aceitara um identificador fechado de toque, nunca um caminho ou URL
arbitraria vindo da rede. O processo principal traduz esse identificador para o
arquivo local conhecido.

Quando o convite especial chega, a sirene substitui o toque padrao e repete em
loop. A reproducao para imediatamente quando o convite for:

- aceito;
- recusado;
- cancelado pelo remetente;
- substituido por outro estado;
- expirado depois dos 30 segundos existentes.

Convites comuns continuam usando `som-chamada.mp3`. Se a versao do aplicativo
do destinatario ainda nao possuir a sirene ou a reproducao falhar, o convite
visual continua funcionando; falha de som nunca bloqueia aceitar ou recusar.

## Seguranca e limites

- O servidor nao aceita caminhos de arquivo, URLs ou nomes de som livres.
- O cliente do destinatario escolhe somente entre `padrao` e `sirene`.
- A regra existente de um convite pendente por destinatario continua ativa.
- A duracao existente de 30 segundos nao muda.
- A preferencia local do remetente nao e enviada ao banco nem exposta a outros
  usuarios.
- O arquivo original nao e lido do disco em tempo de execucao.

## Componentes afetados

- Preferencia local do cliente: le, grava e notifica mudancas do checkbox.
- `SettingsScreen`: mostra o checkbox somente para a conta autorizada.
- Fluxo de convite no cliente: inclui a intencao da sirene quando habilitada.
- Servidor de voz: valida a ID exclusiva e sanitiza o tipo do toque.
- Payload do convite: informa `padrao` ou `sirene` ao destinatario.
- Ponte Electron: aceita o identificador fechado do toque.
- Processo principal do Electron: seleciona e reproduz o MP3 empacotado.
- Empacotamento desktop: inclui `dog-siren.mp3` junto dos demais sons.

## Validacao

- Teste da preferencia local: padrao desativado, persistencia e isolamento por
  dispositivo.
- Teste de autorizacao: a conta configurada consegue enviar `sirene`; outra
  conta que forja o campo recebe um convite normal.
- Teste do servidor: convite normal permanece inalterado e as regras de membro,
  canal, duplicidade e expiracao continuam funcionando.
- Teste da ponte Electron: apenas os identificadores conhecidos selecionam
  arquivos locais; texto arbitrario cai no toque padrao.
- Teste do ciclo de vida: aceitar, recusar, cancelar e expirar param o loop.
- Build de producao do cliente e do desktop.
- Teste manual com duas contas e dois computadores: checkbox desligado usa o
  toque atual; ligado usa a sirene; outro administrador continua sem acesso.

## Fora de escopo

- Permitir upload ou escolha livre de sons.
- Disponibilizar a sirene para outros administradores.
- Tocar a sirene em notificacoes que nao sejam convite de chamada.
- Alterar o banner, a duracao ou as regras de resposta do convite.
- Fazer deploy antes dos testes locais e da aprovacao da versao de teste.
