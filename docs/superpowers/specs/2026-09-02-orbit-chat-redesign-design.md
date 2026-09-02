# Orbit: restauracao do chat e redesign do cliente

Data: 2026-09-02

## Objetivo

Transformar o Orbit na unica interface oficial do Discord Caseiro, com a densidade e a previsibilidade de um cliente desktop de comunicacao usado diariamente. O trabalho deve restaurar integralmente o comportamento do chat antes de alterar sua aparencia, corrigir mencoes e notificacoes e substituir a camada visual artificial recente por um sistema neutro, consistente e funcional.

## Auditoria do estado atual

- O servidor esta executando uma versao do cliente mais nova que a existente no repositorio local. Ela inclui Cinema, sessoes sincronizadas e melhorias de chamadas. Esses arquivos precisam voltar para o controle de versao antes do redesign; arquivos `.bak` do servidor nao entram no repositorio.
- `OrbitApp.jsx` recriou compositor, lista e linhas de mensagem em vez de usar `ChatView.jsx`. Essa implementacao reduzida nao possui o autocomplete de `@`, a codificacao da mencao, replies, edicao, fixacao, encaminhamento, denuncia, comandos e todos os estados do chat principal.
- O texto digitado no compositor do Orbit e enviado diretamente. Um texto como `@nome` pode parecer uma marcacao, mas nao vira o token persistente `<@id>` e, portanto, nao aciona a deteccao por ID nem a notificacao.
- A regra de notificacao atual nao cobre corretamente o caso em que o canal esta aberto, mas a janela perdeu foco. Tambem nao existe som de mencao separado da notificacao nativa.
- O contador atual representa apenas mensagens nao lidas. Nao ha um estado persistente e separado para mencoes.
- O final de `orbit.css` adiciona uma segunda camada de estilos com fundo radial, gradientes, glow, sombras, transformacoes e espacamentos maiores. Essa sobreposicao contradiz a interface densa pedida e dificulta a manutencao.
- A estrutura em quatro paineis existe, mas a densidade e inconsistente: o fluxo de mensagens parece fragmentado, controles simples recebem containers excessivos e as superfices dependem demais de bordas e efeitos.

## Alternativas consideradas

### 1. Reutilizar o ChatView completo no Orbit (escolhida)

`OrbitApp` passa a compor o chat oficial com `ChatView` tanto em canais quanto em DMs. A copia simplificada de compositor e mensagens e removida. E a opcao de menor risco, devolve as funcoes ja testadas e elimina divergencias futuras.

### 2. Extrair um novo nucleo compartilhado de mensagens

Criar componentes novos para timeline, compositor e acoes e migrar as duas interfaces. Produziria uma arquitetura valida, mas aumentaria muito o volume de refatoracao e manteria duas cascas sem necessidade, pois a interface classica foi descontinuada.

### 3. Completar a copia do Orbit

Replicar no Orbit cada funcao ausente. Foi rejeitada porque continuaria havendo duas implementacoes concorrentes e todo recurso futuro teria de ser corrigido duas vezes.

## Arquitetura escolhida

### Fonte de verdade

1. Capturar no Git os arquivos que hoje existem apenas no servidor, preservando Cinema, watch together, chamadas e fullscreen.
2. Manter `App.jsx` como dono de sessao, dados, WebSocket, notificacoes, chamadas e modais.
3. Manter `ChatView.jsx` como unica implementacao de timeline e compositor para canal e DM.
4. Fazer `OrbitApp.jsx` apenas compor rail, canais, chat, membros, chamadas e Cinema. Ele nao tera uma segunda implementacao de mensagens.
5. Remover o caminho visual classico e os estados mortos relacionados a alternancia de interface, sem remover os componentes compartilhados ainda usados por configuracoes, voz e modais.

### Contrato do chat

O `ChatView` oficial continua oferecendo historico, paginacao, agrupamento por autor e intervalo, divisores de data e nao lidas, replies, edicao, exclusao, fixacao, busca, anexos, GIFs, reacoes, encaminhamento, denuncia, comandos, digitacao e menus de contexto. Orbit fornece todas as props ja usadas pelo fluxo classico; nenhum callback funcional sera omitido.

## Mencoes por identidade

### Composicao

- Digitar `@` abre um seletor navegavel por teclado e mouse.
- A busca considera nome de usuario e apelido do servidor.
- A escolha guarda uma entidade de mencao com `userId`, rotulo visivel e intervalo no texto. O identificador nao e inferido novamente pelo nome no momento do envio.
- Se o usuario editar o interior de uma mencao selecionada, a entidade e invalidada e volta a ser texto comum. Edicoes antes ou depois apenas deslocam o intervalo.
- No envio, entidades validas sao convertidas de tras para frente em `<@id>`. `@everyone` vira `<@everyone>`.
- A digitacao manual antiga continua compativel quando houver um unico nome inequivoco; nomes duplicados exigem selecao no autocomplete.

### Persistencia e renderizacao

- O conteudo persistido continua usando `<@id>`, preservando mensagens existentes.
- A renderizacao resolve o ID contra o membro atual. Alterar nickname muda apenas o rotulo exibido, nunca o destinatario.
- IDs ausentes sao mostrados como `@usuario`, sem quebrar a mensagem.
- A mensagem mencionando o usuario recebe realce semantico discreto, com tarja lateral e fundo de baixa intensidade; o estado nao depende apenas de cor.

### Registro de mencoes

O servidor passa a ser a autoridade dos destinatarios. Ao aceitar uma mensagem, valida tokens contra membros do servidor, cria registros de mencao por usuario e emite um evento dirigido para cada destinatario. `@everyone` cria destinatarios para os membros elegiveis, exceto o autor. Isso permite contador persistente, evita ambiguidade por nome e impede que o cliente invente destinatarios invalidos.

O estado de mencao e separado de mensagens nao lidas:

- cada canal mostra seu numero de mencoes pendentes;
- a barra de servidores agrega mencoes por servidor;
- clicar no canal com mencoes, inclusive quando ele ja estiver ativo, reconhece as mencoes daquele canal;
- reiniciar o app nao perde os contadores;
- excluir uma mensagem remove sua mencao pendente; editar recalcula os destinatarios.

## Som e notificacoes

Para cada mencao recebida do servidor, exceto mensagens proprias:

1. Sempre atualizar o contador, destacar a mensagem e reproduzir um som curto de mencao.
2. Se a janela estiver sem foco, minimizada, em segundo plano ou o usuario estiver em outro canal, tambem chamar a notificacao nativa do Windows.
3. Se o canal mencionado estiver visivel e a janela estiver focada, nao criar notificacao do Windows.
4. Mensagens comuns continuam obedecendo aos niveis e silencios existentes. O status `Nao perturbe` continua sendo respeitado pelas notificacoes comuns; a regra aprovada de mencao permanece independente para contador e destaque.
5. O evento de mencao e o unico responsavel pelo som e pela notificacao de mencao, evitando disparo duplicado junto de `message:new`.

## Direcao visual

### Personalidade

Cliente desktop maduro, discreto e denso. A identidade Orbit aparece em detalhes de selecao e no acento azul, nao em efeitos. O resultado deve lembrar a logica de um aplicativo de comunicacao real sem ser uma copia pixel a pixel do Discord.

### Sistema visual

- Fonte: pilha local de `Segoe UI Variable`, `Segoe UI` e `system-ui`, com poucos tamanhos e pesos.
- Paleta: rail quase preto, sidebar neutra escura, chat levemente mais claro, membros no mesmo nivel da sidebar, popovers elevados por contraste tonal.
- Acento: azul frio moderado; verde apenas para presenca/sucesso, amarelo para alerta e vermelho para erro/mencao.
- Sem gradientes decorativos, glow, fundo radial ou sombras em controles comuns. Sombras ficam restritas a modais, menus e popovers.
- Raios entre 4 e 8 px em controles e paineis; avatares e indicadores de presenca continuam circulares.
- Movimento entre 100 e 180 ms apenas em hover, abertura e mudanca de estado; `prefers-reduced-motion` desliga transicoes nao essenciais.

### Proporcoes desktop

- Barra de servidores: 64 px.
- Lista de canais/DMs: 232 a 240 px.
- Chat: ocupa o restante e nunca recebe largura maxima artificial.
- Lista de membros: 220 a 232 px, recolhivel.
- Cabecalhos: 48 px.
- Linhas de canal: 32 a 34 px.
- Linhas de membro: 40 a 44 px.
- Compositor: integrado ao rodape, altura inicial de 44 px, margem horizontal de 16 px e icones sem caixas individuais desnecessarias.

### Timeline

- Primeira mensagem de um grupo mostra avatar, autor e hora.
- Mensagens consecutivas do mesmo autor em ate cinco minutos ocultam avatar e cabecalho, exibindo a hora apenas no hover/foco.
- Linha de texto com altura compacta e sem card individual.
- Acoes aparecem no hover ou foco da mensagem, sem deslocar o layout.
- Replies, anexos, embeds, reacoes e estados de envio permanecem no mesmo fluxo vertical.
- Divisores de data e novas mensagens usam uma unica linha discreta.

### Navegacao e paineis

- Rail compacto, com indicador lateral claro para servidor ativo e badges de nao lidas/mencoes.
- Categorias e canais usam contraste e peso, sem bordas em cada linha.
- Lista de membros exibe mais pessoas por viewport; cargos deixam de competir com o nome.
- Header prioriza canal e topico; fixadas, membros e busca permanecem como icones com tooltip e foco visivel.
- Menus, modais, configuracoes, perfis e telas de servidor compartilham tokens, controles e estados.
- A chamada mantem os blocos funcionais ja implementados, mas perde fundos radiais, glow e elevacao exagerada.
- Cinema preserva imagens e hierarquia editorial necessarias ao catalogo, mas remove animacoes em cascata e efeitos decorativos que atrasam a leitura.

## Responsividade

- Acima de 1100 px: quatro paineis completos.
- Entre 800 e 1099 px: membros fechados por padrao e acessiveis pelo botao do header.
- Abaixo de 800 px: rail permanece compacto; canais e membros abrem como paineis sobrepostos; chat ocupa a largura restante.
- Abaixo de 560 px: apenas uma area principal por vez, com navegacao de retorno, sem overflow horizontal e com alvos de toque de pelo menos 40 px.
- Voz e Cinema reorganizam grades e controles sem remover acoes.

## Acessibilidade e feedback

- HTML semantico, labels reais, foco visivel e navegacao completa por teclado.
- Autocomplete de mencao com papel de lista, item ativo e selecao por setas, Enter, Tab e Escape.
- Estados de hover nao sao a unica forma de acessar acoes de mensagem.
- Loading, erro e vazio continuam visiveis e recebem texto acionavel quando houver proximo passo.
- Contraste minimo de texto e controles sera verificado; estado ativo nao dependera apenas de cor.

## Validacao

### Automatizada

- Testes puros do parser e codificador de mencoes: selecao por ID, nomes iguais, nickname alterado, edicao do texto, `@everyone` e mensagens antigas.
- Teste de integracao com dois usuarios para envio, persistencia, evento dirigido, contador, reconhecimento e edicao/exclusao.
- Testes da matriz foco/canal para som e notificacao nativa, usando ponte de desktop simulada.
- Suite existente de chat, servidor e notificacoes sem regressao.
- Build de producao do cliente e verificacao de lint/sintaxe disponivel no projeto.

### Visual e funcional

- Capturas em 1366x768, 1024x768, 768x1024 e 390x844.
- Fluxos: canal, DM, composer expandido, autocomplete, reply, anexo, GIF, reacao, busca, fixadas, membros, configuracoes, chamada e Cinema.
- Verificacao de overflow, sobreposicao, texto truncado, foco, navegacao por teclado e estados vazios.
- Segunda passagem especifica procurando cards sem funcao, gradientes, glow, espacos vazios artificiais, icons encaixotados e animacoes sem funcao.

## Criterios de aceite

1. Existe uma unica implementacao principal de chat.
2. `@` abre o autocomplete e selecionar um usuario envia seu ID real.
3. Usuarios com nomes iguais e mudancas de nickname nao alteram o destinatario.
4. Mencao recebida sempre gera realce, contador persistente e som.
5. Outro canal ou janela sem foco tambem gera notificacao nativa do Windows.
6. Canal visivel com janela focada nao gera notificacao nativa duplicada.
7. Replies, anexos, GIFs, reacoes, edicao, exclusao, fixacao, busca, encaminhamento, denuncia e comandos continuam funcionando.
8. O cliente preserva chamadas, compartilhamento, sessoes de Cinema e fullscreen atuais.
9. A interface nao contem a camada visual `Orbit visual refresh` nem estilos equivalentes de gradiente, glow e elevacao decorativa.
10. Os quatro paineis apresentam densidade e proporcoes naturais em desktop e se reorganizam sem perda funcional em telas menores.
