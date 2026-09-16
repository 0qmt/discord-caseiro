# Painel Minecraft — Base de Operacoes

Data: 2026-09-16

## Objetivo

Transformar o painel atual do servidor Minecraft no Umbrel em uma central de operacoes clara, segura e visualmente ligada ao universo Minecraft. A nova interface deve facilitar as tarefas frequentes — verificar saude, controlar energia, administrar mundos, loaders, mods, plugins, jogadores, backups e automacoes — sem perder informacao tecnica nem simular garantias que o sistema nao consegue provar.

O primeiro resultado continua sendo um unico app Umbrel e um unico servidor Minecraft ativo por vez. A arquitetura prepara perfis independentes e concorrencia futura, mas executar varios servidores simultaneamente fica fora deste ciclo por causa do limite atual de CPU e RAM do host.

## Evidencia e referencia visual

- O painel instalado foi auditado diretamente no Umbrel em `pepo-minecraft`.
- A implementacao atual e um arquivo Node autocontido de aproximadamente 70 KB que mistura processo Java, arquivos, APIs, HTML, CSS e JavaScript.
- O servidor atual executa Fabric 0.19.5 com Minecraft 1.21.11, apesar de partes da interface anunciarem Paper.
- O pacote fornecido em `D:\João\Downloads\saveweb2zip-com-www-minecraft-net` contem a biblioteca visual, fontes e recursos oficiais do site Minecraft. O unico HTML salvo e a pagina 404, portanto ela serve como referencia de componentes e identidade, nao como composicao de homepage.
- Os mockups aprovados estao na sessao visual `.superpowers/brainstorm/898-1789593984/`. A direcao escolhida foi **Base de Operacoes**.

## Alternativas consideradas

### 1. Base de Operacoes — escolhida

Usa a linguagem Minecraft em tipografia, paleta, bordas, relevo e pequenos materiais, mantendo a estrutura de uma ferramenta administrativa: sidebar, mundo ativo, metricas, console e alertas. E a melhor combinacao entre identidade, densidade e previsibilidade.

### 2. Site Oficial Adaptado

Usaria hero grande e secoes editoriais semelhantes a uma homepage. Foi rejeitada como direcao principal porque exige rolagem, esconde informacao operacional e transforma tarefas frequentes em navegacao promocional.

### 3. Bancada Redstone

Usaria inventario e crafting como metafora dominante. Foi rejeitada como direcao principal porque a metafora ficaria fragil em listas longas, configuracoes, logs e operacoes avancadas.

## Direcao visual aprovada

### Personalidade

Uma sala de controle construida dentro do mundo Minecraft: robusta, direta e artesanal, sem parecer um launcher generico ou um painel SaaS com tema verde.

### Sistema visual

- Canvas operacional em preto quente `#171615`.
- Superficies em `#262423` e divisores em `#3D3938`.
- Verde Minecraft como acao e sucesso, usando a escala `#A0E081`, `#6CC349`, `#3C8527` e `#2A641C`.
- Ambre para alerta, vermelho terroso para parada/erro e branco mineral `#FCF5F1` para areas de leitura e superficies externas.
- `MinecraftTen` somente em marca, titulos, rotulos curtos e botoes. Corpo, tabelas e formularios usam `Gellix` ou fallback de sistema para preservar legibilidade.
- Bordas retas de 1 a 3 px, sombras deslocadas e relevo interno. Controles comuns nao usam capsulas, vidro, blur, glow ou grandes raios arredondados.
- Texturas e padroes aparecem em baixa intensidade apenas no fundo ou em ilustracoes do mundo. Informacao nunca depende da textura.
- Os recursos baixados podem fornecer as fontes locais. Logos Microsoft/Mojang, artes promocionais e textos oficiais nao serao reutilizados no produto; a identidade propria permanece `Pepocraft`.

### Movimento

- Feedback entre 100 e 180 ms para hover, pressionamento e troca de estado.
- Um botao pressionado perde o relevo e desloca 1 a 2 px, imitando um controle fisico.
- Transicoes longas, animacoes decorativas repetidas e parallax ficam fora do painel.
- `prefers-reduced-motion` remove movimento nao essencial.

## Arquitetura da informacao

### Cabecalho global

- Marca Pepocraft e subtitulo “Central do servidor”.
- Seletor do perfil ativo, inicialmente com `Servidor Principal`; ele prepara a futura separacao por perfil sem expor concorrencia agora.
- Estado global real: online, iniciando, parando, offline ou erro.
- Menu do administrador.

### Navegacao lateral

1. Visao geral
2. Mundos
3. Mods e plugins
4. Jogadores
5. Console
6. Backups
7. Automacao
8. Configuracoes

A navegacao separa operacao cotidiana de seguranca. Em telas pequenas vira drawer; os destinos mais usados ficam em uma barra inferior compacta.

### Visao geral

- Mundo ativo como elemento principal, com loader, versao do Minecraft, Java e pacotes carregados.
- Controles iniciar, parar e reiniciar sempre visiveis. `Forcar kill` fica dentro de um menu de emergencia com confirmacao reforcada.
- Endereco LAN com copia rapida. Endereco externo e configuracao de rede ficam protegidos em uma area propria.
- Jogadores, memoria Java, memoria do Umbrel, CPU, uptime e armazenamento.
- Console resumido com acesso ao console completo.
- Atividade recente e alertas acionaveis.

## Loaders e distribuicoes

O painel deixa de escolher o executavel pela simples existencia de um arquivo. Uma configuracao explicita identifica o loader ativo e o processo confirma o que realmente iniciou.

### Catalogo inicial

- Vanilla
- Paper
- Purpur
- Fabric
- Quilt
- Forge
- NeoForge

Spigot nao tera instalacao automatica neste ciclo por depender de processo de build/licenciamento diferente; servidores proxy como Velocity e Waterfall nao sao loaders de mundo e ficam fora do escopo. O catalogo e extensivel por adaptadores, sem condicoes espalhadas pelo codigo.

### Contrato de um adaptador

Cada loader declara:

- como listar versoes suportadas;
- como obter e validar o artefato oficial;
- qual versao de Java exige;
- qual comando inicia o servidor;
- onde ficam mods ou plugins;
- como detectar o loader e a versao nos logs;
- como listar pacotes realmente carregados;
- quais verificacoes de saude suporta.

### Troca segura

1. Validar compatibilidade do loader, Minecraft, Java e mundo.
2. Criar backup do mundo e da configuracao.
3. Parar o servidor com salvamento gracioso.
4. Instalar o novo artefato em staging.
5. Atualizar a configuracao explicita do perfil.
6. Iniciar e aguardar o marco de prontidao.
7. Confirmar loader e versao reais nos logs.
8. Em falha, restaurar a configuracao anterior e oferecer reinicio com o loader anterior.

O painel nunca anuncia Paper quando o processo esta em Fabric. A interface mostra `configurado`, `detectado` e qualquer divergencia entre os dois.

## Mods e plugins

### Navegacao contextual

- Fabric, Quilt, Forge e NeoForge priorizam **Mods**.
- Paper e Purpur priorizam **Plugins**.
- Vanilla informa que nao carrega pacotes desse tipo.
- A area incompatível permanece acessivel apenas para explicar por que seus arquivos nao serao carregados; ela nao os marca como ativos.

### Operacoes

- Listar arquivos ativos e desativados.
- Exibir nome, versao, origem, loader, versoes do Minecraft, dependencias, tamanho e data.
- Buscar no Modrinth ja filtrando loader e versao.
- Instalar por Modrinth, link direto ou upload.
- Instalar dependencias com confirmacao.
- Ativar, desativar, atualizar ou remover.
- Agrupar alteracoes pendentes e aplicar em um unico reinicio seguro.
- Criar snapshot antes de qualquer lote de mudancas.
- Reverter automaticamente o lote quando ele impede o servidor de ficar pronto.

Downloads por URL aceitam apenas HTTP/HTTPS, limitam tamanho e validam o JAR antes de substituir um arquivo existente. Arquivos nunca sao executados fora do processo normal do loader.

## Validacao de mods e plugins

O painel nao usa apenas a palavra “funcionando”. Ele exibe um nivel de evidencia:

1. **Arquivo valido** — o JAR abre e possui metadados reconheciveis.
2. **Compativel** — loader, Minecraft, Java e dependencias declaradas combinam.
3. **Carregado** — o loader citou o pacote como carregado, ou Paper/Purpur o retornou na lista de plugins.
4. **Mundo iniciou** — o servidor chegou ao estado pronto com o pacote ativo e sem erro fatal associado.
5. **Funcao confirmada** — um teste especifico foi executado ou o administrador confirmou o comportamento dentro do jogo.

### Teste automatico

- Ler metadados do JAR antes da instalacao.
- Resolver dependencias e conflitos conhecidos.
- Fazer backup e reinicio controlado.
- Acompanhar logs desde o inicio ate `Done`, timeout ou falha.
- Confirmar que o pacote aparece na lista real do loader.
- Executar comandos de saude seguros quando o loader permitir.
- Verificar que a porta responde e que o processo continua vivo por uma janela curta de estabilidade.
- Vincular erros, mixins ou stack traces ao pacote mais provavel sem declarar causalidade absoluta quando a evidencia for ambigua.

### Teste funcional no mundo

Nao existe um teste generico capaz de provar o comportamento de qualquer mod sem um jogador ou bot. Por isso, o painel oferece roteiros por pacote e registra o resultado por versao do mod e do mundo. Para Tree Harvester, por exemplo: entrar, usar um machado, agachar e quebrar uma arvore natural; o usuario marca `Funcionou` ou `Falhou` e pode anexar a parte relevante do log.

O texto final diferencia claramente `carregado sem erros` de `funcao confirmada no jogo`.

## Mundos

- Mostrar nome, tamanho, seed quando disponivel, modo, dificuldade, versao usada, ultimo acesso e ultimo backup.
- Criar mundo, importar ZIP, baixar, clonar, renomear e excluir.
- Troca segura: `save-all`, backup, parada, mudanca, inicio e health check.
- Exclusao exige nome digitado e nunca remove silenciosamente o unico backup.
- Um mundo aberto por versao mais nova recebe aviso antes de qualquer downgrade.
- Mods, plugins e loader continuam globais no primeiro ciclo. A interface e o modelo de dados preparam sua futura associacao a perfis independentes.

## Jogadores

- Lista online com skin, nome, entrada, tempo de sessao e estado de operador/whitelist.
- Historico de ultima conexao e tempo jogado a partir dos dados disponiveis no mundo e nos logs.
- Adicionar/remover whitelist, conceder/remover operador, expulsar, banir e desbanir.
- Enviar mensagem privada ou aviso global.
- Toda acao administrativa gera entrada no historico; banimento e remocao de operador exigem confirmacao.
- A interface nao inventa ping, localizacao ou estatisticas que o servidor nao exponha.

## Console

- Streaming ao vivo com pausa de rolagem, busca e filtros por nivel.
- Historico local de comandos e favoritos.
- Atalhos para `list`, `save-all`, whitelist e mensagens.
- Copia e download de logs.
- Destaque de erros de inicializacao com ligacao para a validacao de pacotes.
- Limpar a tela nao apaga o arquivo de log.

## Backups

- Backup manual e automatico.
- Backups obrigatorios antes de loader, versao, mundo ou lote de pacotes.
- Restauracao do mundo ou do conjunto completo de configuracao.
- Data, tamanho, origem, conteudo e resultado da verificacao.
- Retencao configuravel por quantidade e limite de armazenamento.
- Operacao atomica: arquivos temporarios nao aparecem como backups validos.
- Restauracao sempre ocorre com servidor parado e cria um ponto de retorno antes de substituir dados.

## Automacao

A primeira versao usa receitas prontas, nao um construtor de regras arbitrarias:

- iniciar, parar ou reiniciar por horario e dias da semana;
- parar apos um periodo sem jogadores;
- backup agendado;
- reinicio periodico com contagem regressiva no chat;
- executar comandos seguros em horario definido.

Cada automacao possui nome, estado, proxima execucao, ultima execucao e historico. Uma acao que interrompe o servidor avisa jogadores, salva o mundo e cria backup quando configurado. Atualizacoes automaticas de loader, mods ou plugins ficam desligadas por padrao e fora deste ciclo.

## Configuracoes

- Jogabilidade
- Mundo e geracao
- Rede e acesso
- Whitelist e seguranca
- Desempenho e memoria
- Java e opcoes avancadas

Campos conhecidos recebem controles apropriados, descricao e validacao. Propriedades desconhecidas permanecem editaveis na area avancada. Cada alteracao informa se e imediata ou exige reinicio. O limite de RAM considera memoria real disponivel e reserva margem para Umbrel e outros apps.

## Arquitetura tecnica

O app continua em Node e no mesmo container, mas responsabilidades deixam o arquivo unico:

- `src/process-manager.js`: ciclo do Java, comandos, estado e operacoes exclusivas.
- `src/loaders/`: adaptadores de Vanilla, Paper, Purpur, Fabric, Quilt, Forge e NeoForge.
- `src/package-manager.js`: mods, plugins, Modrinth, upload e staging.
- `src/validation-service.js`: preflight, health check, evidencias e rollback.
- `src/world-service.js`: inventario e troca segura de mundos.
- `src/backup-service.js`: criacao, retencao, verificacao e restauracao.
- `src/player-service.js`: sessao, whitelist, ops e moderacao.
- `src/automation-service.js`: receitas e agendamento persistente.
- `src/config-store.js`: configuracao versionada e migracao do `panel.json` atual.
- `src/http-server.js`: API, SSE e entrega do frontend.
- `public/`: HTML, CSS, JavaScript e fontes do novo painel.

Dados novos ficam em `/data/panel/`, usando JSON atomico e JSONL para historicos. O mundo, `server.properties`, JARs e pastas atuais permanecem no lugar e sao migrados sem apagar dados. Apenas uma operacao mutavel de servidor pode ocorrer por vez; as demais recebem estado de ocupacao e progresso.

## Fluxo de dados e estados

1. O frontend pede um snapshot inicial da API.
2. SSE envia estado do processo, logs, progresso de operacoes e alertas.
3. Acoes longas retornam um `operationId`; a interface acompanha etapas sem bloquear a pagina.
4. O backend persiste mudancas por escrita temporaria seguida de rename.
5. Falhas retornam codigo, mensagem para usuario, detalhe tecnico e proximo passo seguro.

Estados obrigatorios: carregando, vazio, offline, iniciando, pronto, parando, ocupado, incompatível, falha recuperavel e falha que exige intervencao.

## Responsividade e acessibilidade

- Acima de 1100 px: sidebar fixa e conteudo completo.
- Entre 720 e 1099 px: sidebar compacta por icones e paineis em duas ou uma coluna.
- Abaixo de 720 px: drawer de navegacao, barra inferior para Visao geral/Mundos/Pacotes/Console e controles de energia em faixa fixa segura.
- Alvos de toque de pelo menos 40 px, foco visivel, labels reais e navegacao por teclado.
- Estado nao depende apenas de cor; icone e texto acompanham sucesso, alerta e erro.
- Fontes pixel nao sao usadas em paragrafos, logs ou formularios.

## Seguranca e tratamento de erros

- Confirmacao reforcada para kill, exclusao, restauracao, downgrade e troca de loader.
- Backup antes de operacoes com risco de dados.
- Sanitizacao de nomes e caminhos; nenhuma entrada pode escapar de `/data`.
- Limite de upload, timeout e limpeza de temporarios.
- URLs, tokens e segredos nao aparecem em logs do navegador.
- O historico registra acao, momento, resultado e origem, sem armazenar senha.
- Falha de health check nao apaga arquivos; o rollback e explicito e verificavel.

## Fases de implementacao

### Fase 1 — fundacao e nova casca

Separar o nucleo minimo, migrar configuracao, implementar o sistema visual Base de Operacoes, Visao geral, console e deteccao verdadeira do loader sem perder os recursos atuais.

### Fase 2 — loaders e pacotes

Criar adaptadores, troca segura, tela contextual de Mods/Plugins, staging, dependencias, evidencias de validacao e rollback.

### Fase 3 — mundos, backups e jogadores

Implementar inventario de mundos, troca segura, backup/restauracao e administracao de jogadores.

### Fase 4 — automacao e acabamento

Adicionar receitas de automacao, historicos, responsividade final, acessibilidade, documentacao e migracao validada no Umbrel.

Cada fase precisa deixar o servidor utilizavel e poder ser implantada separadamente.

## Validacao

### Automatizada

- Testes unitarios do catalogo de loaders, selecao do executavel, parsing de logs e metadados de JAR.
- Testes de compatibilidade, dependencias, operacao exclusiva e rollback.
- Testes de escrita atomica e migracao do `panel.json` atual.
- Testes das APIs destrutivas, sanitizacao de caminho e limites de upload.
- Testes de automacao com relogio controlado.
- Verificacao de sintaxe, inicializacao do app e rotas principais.

### Integracao no Umbrel

- Backup externo antes do primeiro deploy.
- Confirmar que o mundo atual e os quatro mods instalados permanecem intactos.
- Iniciar Fabric 1.21.11 e comprovar que Fabric API, Upgrader, Collective e Tree Harvester chegam aos niveis de evidencia esperados.
- Parar, iniciar e reiniciar sem processos Java orfaos.
- Fazer backup, restaurar em staging e comparar conteudo essencial.
- Testar pelo menos um fluxo de cada loader suportado sem usar o mundo principal quando houver risco de conversao.

### Visual

- Capturas em 1440x900, 1024x768 e 390x844.
- Visao geral, Mundos, Mods/Plugins, Jogadores, Console, Backups, Automacao e Configuracoes.
- Estados online, offline, iniciando, operacao em progresso, vazio, incompatibilidade e erro.
- Verificacao de overflow, contraste, foco, teclado, toque e reducao de movimento.

## Criterios de aceite

1. A interface segue a direcao Base de Operacoes aprovada e permanece legivel em desktop e celular.
2. O loader exibido e o loader realmente iniciado; divergencias sao visiveis.
3. Vanilla, Paper, Purpur, Fabric, Quilt, Forge e NeoForge possuem adaptadores isolados e contratos testados.
4. Trocar loader ou versao cria backup, valida o ambiente e oferece rollback quando a inicializacao falha.
5. Mods e plugins mostram compatibilidade e nivel de evidencia, sem chamar apenas carregamento de “funcionamento confirmado”.
6. Tree Harvester pode ser identificado como carregado automaticamente e confirmado funcionalmente por roteiro no mundo.
7. Alteracoes de pacotes podem ser agrupadas, aplicadas em reinicio seguro e revertidas quando quebram o startup.
8. Mundos podem ser inventariados, importados, baixados e trocados com backup e health check.
9. Jogadores podem ser administrados com confirmacao e historico.
10. Backups sao atomicos, restauraveis e sujeitos a retencao configuravel.
11. Automacoes avisam jogadores, salvam o mundo e registram resultado.
12. O painel migra os dados atuais sem apagar mundo, mods, configuracoes ou lista de acesso.
13. A operacao normal nao deixa processos Java orfaos nem executa duas mutacoes concorrentes.
14. Forcar kill e demais operacoes destrutivas nao ficam expostas como acoes primarias.

## Fora do escopo deste ciclo

- Varios servidores Minecraft simultaneos.
- Proxy Velocity/Waterfall e rede de servidores.
- Bot jogador para automatizar mecanicas dentro do mundo.
- Atualizacao automatica silenciosa de loader, mods ou plugins.
- Publicacao comercial ou imitacao integral do site oficial Minecraft.
