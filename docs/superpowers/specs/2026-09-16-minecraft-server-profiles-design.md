# Perfis completos do servidor Minecraft

## Objetivo

Permitir manter vários perfis completos no mesmo app Umbrel, com apenas um servidor Minecraft ativo por vez. Cada perfil tem mundo, loader, versão e configurações próprios. Mods já baixados ficam disponíveis em uma biblioteca comum para serem reutilizados por outros perfis sem novo download ou duplicação desnecessária.

O mundo atual será migrado para o primeiro perfil, inicialmente chamado `Principal`, sem mover ou recriar seus dados durante a primeira adoção.

## Modelo do perfil

Cada perfil registra:

- identificador estável e nome editável;
- diretório do mundo, incluindo as dimensões produzidas pelo loader;
- versão do Minecraft;
- loader e launcher selecionados;
- propriedades do servidor;
- memória e flags Java;
- lista de mods ou plugins habilitados;
- estado da última inicialização e histórico curto de falhas;
- referência aos backups desse perfil.

Dados normais do Minecraft, como inventário, posição, XP e Ender Chest, permanecem dentro dos arquivos do próprio mundo. O painel não cria mecanismo adicional para compartilhar esses dados.

## Biblioteca comum de pacotes

Mods e plugins são armazenados uma única vez em uma biblioteca comum, identificados pelo hash SHA-256 do arquivo. A biblioteca mantém nome, tamanho, loader detectado, versão do Minecraft declarada, dependências conhecidas e origem do download.

Cada perfil possui somente uma lista de referências aos pacotes escolhidos. Ao ativar o perfil, o painel materializa sua pasta `mods` ou `plugins` usando links locais no mesmo volume. Se o sistema de arquivos não aceitar links, usa cópia local como fallback e informa isso na interface.

As pastas ativas `/data/mods` e `/data/plugins` funcionam como uma área de execução reconstruível. A fonte permanente é a biblioteca comum mais o manifesto do perfil. O painel prepara a nova composição em uma pasta temporária e só a coloca em uso depois que todos os links ou cópias forem criados com sucesso.

As operações disponíveis são:

- selecionar pacotes individualmente na biblioteca;
- importar a seleção completa de outro perfil;
- escolher alguns pacotes de outro perfil;
- retirar um pacote somente do perfil atual;
- instalar uma nova versão do pacote na biblioteca sem atualizar os demais perfis automaticamente.

Antes de anexar um pacote, o painel verifica loader, versão do Minecraft e dependências identificáveis. Pacotes incompatíveis não são ativados e exibem o motivo.

## Criação de perfil

O formulário pede somente:

1. nome do perfil;
2. versão do Minecraft;
3. loader;
4. origem dos mods: vazio, copiar todos de outro perfil ou escolher individualmente.

O Minecraft cria o mundo do zero na primeira inicialização, com o comportamento normal do jogo. O painel não tenta fabricar arquivos de mundo.

O perfil pode opcionalmente partir de uma cópia de um mundo existente, mas isso é uma ação separada e explícita.

## Troca de perfil

A troca segue uma transação segura:

1. impedir duas trocas concorrentes;
2. avisar jogadores conectados;
3. executar `save-all flush` e parar o servidor atual;
4. criar um ponto de retorno dos arquivos de configuração do perfil atual;
5. selecionar launcher, mundo, propriedades e pacotes do novo perfil;
6. iniciar o servidor;
7. aguardar identificação do loader e conclusão da abertura do mundo;
8. confirmar o novo perfil como ativo.

Se o novo perfil falhar, o painel para o processo, restaura a configuração anterior e reinicia automaticamente o perfil que estava ativo. A falha permanece visível com as últimas linhas relevantes do console.

## Interface

A navegação `Mundos` passa a se chamar `Perfis`.

A tela mostra:

- cartão destacado do perfil ativo;
- lista dos demais perfis com versão, loader, quantidade de pacotes e tamanho do mundo;
- ações `Iniciar este perfil`, `Editar mods`, `Duplicar` e `Excluir`;
- botão `Novo perfil`;
- estado da troca quando uma transação estiver em andamento;
- falha e rollback, quando ocorrerem.

O editor de pacotes permite filtrar a biblioteca por compatibilidade, selecionar pacotes e importar a seleção de outro perfil. Nenhum pacote incompatível é silenciosamente habilitado.

## Armazenamento e migração

O painel mantém um índice em `/data/profiles/profiles.json` e uma pasta por perfil em `/data/profiles/<id>/`. Mundos novos ficam em `/data/profile-worlds/<id>/`; o perfil `Principal` continua apontando para `/data/world`. A biblioteca de pacotes fica em `/data/package-library/`.

Launchers e arquivos de runtime ficam versionados por loader e versão do Minecraft em `/data/runtime-library/<loader>/<versao>/`. Assim, instalar Fabric para um perfil não sobrescreve o Paper ou outra versão utilizada por outro perfil. A área ativa apenas aponta para o runtime escolhido pelo perfil.

Na primeira execução da nova versão:

- o mundo ativo, loader, configurações e lista de mods atuais são registrados como perfil `Principal`;
- os arquivos de mods atuais são incorporados à biblioteca por hash;
- o caminho do mundo atual continua válido;
- nenhuma exclusão ou movimentação destrutiva ocorre;
- a configuração antiga permanece recuperável pelo backup já existente.

## Exclusão

Excluir um perfil exige que ele não esteja ativo. A interface mostra o tamanho e solicita confirmação explícita. A primeira versão move o perfil para uma área recuperável em vez de apagar definitivamente.

Remover um mod de um perfil não remove o arquivo da biblioteca. Limpeza de pacotes não utilizados será uma operação separada e posterior.

## Testes de aceitação

1. O mundo atual aparece como perfil `Principal` sem perda de arquivos.
2. Um perfil novo pode iniciar e o Minecraft gera seu mundo normalmente.
3. Mods do perfil `Principal` podem ser selecionados no novo perfil sem download adicional.
4. Remover ou atualizar um mod em um perfil não altera silenciosamente os outros.
5. Trocar de perfil nunca deixa dois servidores Minecraft ativos.
6. Uma inicialização bem-sucedida identifica loader, pacotes e mundo antes de confirmar a troca.
7. Uma inicialização com erro restaura e reinicia automaticamente o perfil anterior.
8. O painel móvel permite criar, selecionar e acompanhar a troca de perfil.
9. O perfil ativo não pode ser excluído.
10. Todos os arquivos atuais continuam recuperáveis pelo backup pré-implementação.

## Fora deste ciclo

- executar vários servidores Minecraft simultaneamente;
- compartilhar inventário ou dados de jogadores entre mundos;
- teleporte entre mundos carregados ao mesmo tempo;
- apagar automaticamente pacotes não utilizados da biblioteca;
- sincronizar perfis com outro computador ou serviço externo.
