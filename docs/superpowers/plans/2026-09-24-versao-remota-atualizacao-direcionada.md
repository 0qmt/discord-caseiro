# Plano de implementação — versão remota e atualização direcionada

## 1. Contratos testáveis

- Criar utilitários puros no cliente para comparar versões semânticas, montar
  as linhas do menu e controlar a intenção temporária de atualização forçada.
- Criar utilitários puros no servidor para sanitizar a identificação de cada
  socket, autorizar a conta exata e selecionar somente sessões desktop
  instaladas e desatualizadas.
- Cobrir versões iguais, anteriores, posteriores e inválidas, além do limite de
  uma reinicialização da intenção persistente.

## 2. Capacidade privada e versão de referência

- Adicionar `REMOTE_UPDATE_ADMIN_USER_ID` à configuração do servidor.
- Expor `capabilities.remoteClientUpdate` apenas no DTO privado da própria
  conta autorizada.
- Disponibilizar ao servidor a versão do `client/package.json` também na imagem
  final do Docker, para que a seleção de alvos não dependa de uma versão
  enviada pelo navegador administrador.

## 3. Registro de sessões no tempo real

- Manter um mapa em memória por `socket.id`, sem gravar no banco.
- O cliente envia `client:identify` depois de cada conexão, informando
  plataforma, versão, tipo de instalação e disponibilidade do atualizador.
- O servidor envia `client-info:sync` e `client-info:update` exclusivamente à
  sala da conta configurada como administradora.
- Na desconexão, remover a identificação e publicar a lista atualizada daquele
  usuário.

## 4. Comando direcionado

- Implementar `client:force-update` com confirmação por callback.
- Validar a conta remetente, impedir autoalvo, confirmar a propriedade dos
  sockets selecionados e filtrar por desktop instalado, ponte disponível e
  versão realmente anterior à versão atual do servidor.
- Emitir `app:force-update` apenas aos sockets que passaram pelo filtro e
  devolver a quantidade entregue.

## 5. Interface e execução no destinatário

- Guardar no cliente administrador o snapshot privado das sessões.
- Acrescentar ao final do menu de contexto as versões por sessão; somente um
  desktop instalado e desatualizado será clicável como “Reiniciar para
  atualizar”.
- No destinatário, persistir a intenção no `localStorage`, consultar o estado
  do atualizador já existente e instalar imediatamente quando estiver pronto.
- Se o estado estiver ocioso, reiniciar o desktop uma única vez para refazer a
  consulta de release; limpar a intenção em sucesso, versão já atualizada,
  falha, expiração ou limite de tentativas.
- Preservar a marca atual de retomada de chamada antes de qualquer reinício.

## 6. Verificação

- Rodar testes unitários de cliente, servidor e desktop.
- Rodar os builds de produção do cliente e do instalador desktop.
- Conferir `git diff --check`, revisar o diff apenas dos arquivos tocados e
  deixar o deploy separado até a validação local terminar.
