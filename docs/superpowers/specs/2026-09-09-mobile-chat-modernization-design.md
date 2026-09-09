# Modernizacao do chat mobile Orbit

## Objetivo

Adaptar o chat existente para Android sem criar uma segunda implementacao. O chat ocupa toda a tela; a navegacao de servidores e canais aparece apenas ao voltar; selecionar um canal retorna a conversa.

## Estrutura aprovada

- Barra de status nativa separada do conteudo.
- Cabecalho de 56 px com voltar, identidade do canal, resumo de presenca e busca.
- Historico em coluna unica com 16 px de margem, avatares de 40 px e agrupamento existente preservado.
- Compositor flutuante de 56 px, sem borda visivel e com controles existentes.
- Painel de navegacao composto por trilho de servidores e lista de canais.
- Desktop permanece com o layout atual.

## Linguagem visual

- Fundo principal proximo de `#151619`, cabecalho `#17181b` e compositor `#25262a`.
- Metadados discretos, texto normal em 16 px e entrelinha de 22 px.
- Mencoes inline em lavanda suave e linha mencionada com tinta ambar de baixa opacidade.
- Separadores de data discretos; espacos e superficies comunicam hierarquia no lugar de bordas fortes.
- Alvos de toque de pelo menos 40 px e feedback curto ao pressionar.

## Comportamento

- A seta do chat abre servidores + canais.
- Tocar em servidor atualiza a lista de canais sem fechar o painel.
- Tocar em canal ou DM fecha o painel e retorna ao chat.
- Busca continua disponivel no cabecalho; fixadas e membros permanecem acessiveis no desktop.
- Anexos, GIF, envio, replies, edicao, reacoes e menus mantem a logica atual.

## Validacao

- Build web e sincronizacao Capacitor.
- Viewports de 320, 360, 390 e 430 px, alem de desktop.
- Sem overflow horizontal, sobreposicao com status bar ou compositor sob a area de gestos.
- Detector de qualidade visual e verificacao do APK assinado antes da publicacao.
