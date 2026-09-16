# Plano de implementacao — Painel Minecraft Base de Operacoes

Data: 2026-09-16
Especificacao: `docs/superpowers/specs/2026-09-16-minecraft-server-panel-base-operacoes-design.md`

## Entrega 1 — fundacao segura e interface

1. Criar uma copia local implantavel do app atual com `server.js`, `public/`, manifesto, Dockerfile e Compose.
2. Separar HTML, CSS e JavaScript do backend sem remover nenhuma API existente.
3. Migrar `panel.json` de forma compativel, adicionando loader configurado e detectado.
4. Corrigir a selecao do executavel: a presenca do launcher Fabric nao pode substituir uma escolha explicita.
5. Implementar a casca Base de Operacoes e as telas Visao geral, Mundos, Pacotes, Jogadores, Console, Backups, Automacao e Configuracoes.
6. Conectar todas as operacoes ja existentes e sinalizar claramente recursos que ainda dependem das entregas seguintes.
7. Adicionar API de diagnostico de mods/plugins com niveis de evidencia baseados em arquivo, metadados, log e startup.
8. Testar sintaxe, rotas, estados offline/online, desktop e celular.
9. Criar backup remoto do app e dos dados de configuracao, implantar e verificar o mundo e os mods atuais.

## Entrega 2 — loaders e pacotes

1. Criar registro de adaptadores para Vanilla, Paper, Purpur, Fabric, Quilt, Forge e NeoForge.
2. Implementar catalogo e instalacao segura por staging, com Java compativel e rollback.
3. Adicionar dependencias, atualizacoes, lote de mudancas e validacao pos-reinicio.
4. Registrar teste funcional manual por pacote e versao do mundo.

## Entrega 3 — mundos, backups e jogadores

1. Tornar troca de mundo uma operacao transacional com backup e health check.
2. Implementar criacao, clonagem, renomeacao e protecao contra downgrade.
3. Implementar backup atomico, retencao e restauracao.
4. Implementar whitelist, operadores, bans, kick, mensagens e historico de jogador.

## Entrega 4 — automacao e fechamento

1. Implementar receitas de horario, servidor vazio, backup, reinicio com aviso e comandos.
2. Validar concorrencia de operacoes, historico, falhas e recuperacao.
3. Executar auditoria visual, acessibilidade, detector mecanico e revisao final.
4. Documentar operacao, recuperacao e atualizacao do app no Umbrel.

## Regra de implantacao

Cada entrega precisa passar por validacao local, backup do estado remoto, implantacao reversivel e health check. O mundo principal nunca e usado para testar conversao destrutiva de loader ou downgrade.
