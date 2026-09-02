---
name: Orbit
description: Cliente desktop self-hosted de comunicação, com chat denso, chamadas e cinema compartilhado.
colors:
  primary:
    blue-action: '#5865F2'
    blue-focus: '#7C89ED'
  secondary:
    amber-mention: '#F0B232'
    green-online: '#23A559'
  neutral:
    canvas: '#111214'
    surface: '#1A1B1E'
    surface-raised: '#232428'
    border: '#303136'
    text: '#F2F3F5'
    muted: '#B5BAC1'
typography:
  family: Inter, system-ui, sans-serif
  body: 14px / 1.35, 400
  heading: 16px / 1.2, 600
  title: 20px / 1.15, 700
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  unit: 4px
  scale: 4px, 8px, 12px, 16px, 24px, 32px
---

# Overview

**Creative North Star: "A sala que continua aberta"**

Orbit é um cliente local de comunicação: conversa, pessoas, chamadas e cinema ficam no mesmo espaço de trabalho, com prioridade para leitura rápida e ações previsíveis. A interface usa densidade de software desktop real, não composição de cartões promocionais.

O contraste nasce de superfícies de carvão próximas, texto legível e uma cor de ação reservada para seleção e foco. Menções usam âmbar porque são atenção contextual, enquanto presença online usa verde sem competir com a conversa.

**Key Characteristics:**
- Fluxo contínuo de mensagens, com agrupamento por autor e pouca repetição visual.
- Trilho compacto de servidores, canais organizados, chat flexível e membros escaneáveis.
- Cinema e chamadas tratados como destinos funcionais, com estados claros e controles diretos.
- Ícones de traço único, bordas discretas e movimento curto apenas para confirmar mudanças.

**The One Surface Rule.** Use tons próximos para separar áreas; bordas são apoio, nunca a estrutura principal.

**The Conversation Rule.** O conteúdo da conversa ocupa o espaço; controles aparecem quando são necessários.

# Colors

Azul é reservado para ações, seleção e foco. Âmbar identifica uma menção recebida. Verde comunica presença. O restante da interface permanece em carvão neutro para manter o chat como foco.

**The Semantic Accent Rule.** Uma cor só ganha destaque quando comunica estado ou ação; não há glow decorativo.

# Typography

Inter (ou o fallback de sistema) mantém leitura compacta, familiar e estável em desktop e mobile. Títulos usam peso para hierarquia; o corpo permanece regular para não transformar cada mensagem em uma chamada visual.

**The Quiet Hierarchy Rule.** Tamanho e peso distinguem cabeçalhos; caixa alta e excesso de bold não substituem organização.

# Layout

O shell usa trilho de servidores de 64px, lista de canais de 232px, chat fluido e membros de 224px em desktop. O cabeçalho do chat tem 48px e o compositor fica integrado ao rodapé. Em telas pequenas, canais e membros viram superfícies móveis sem criar overflow horizontal.

**The Desktop Density Rule.** A largura disponível serve primeiro ao histórico e ao compositor, não a espaços vazios.

# Elevation & Depth

A profundidade vem de mudanças sutis entre canvas, superfícies e superfícies elevadas. Sombras são pequenas e funcionais, usadas apenas para menus, drawers e modais.

# Shapes

Controles têm cantos pequenos (4px a 8px), sem aparência de cápsula. Avatares permanecem circulares por convenção de presença; tiles de chamada e mídia usam proporções estáveis.

# Components

## Mensagem agrupada

Mensagens consecutivas do mesmo usuário compartilham avatar e cabeçalho. Ações ficam discretas até hover, foco ou toque, e menções mantêm realce âmbar e identidade por ID.

## Compositor

O campo inferior é uma faixa única integrada ao chat, com anexos, menção, GIF e envio. Foco visível usa o azul de foco; estados de envio e erro devem ser imediatos.

## Navegação

Servidor, canal, cinema e configurações usam ícones consistentes com tooltip. O estado ativo usa superfície elevada e azul de seleção, sem brilho.

## Cinema

O catálogo usa navegação superior, busca, abas e fileiras de pôsteres com foco em descoberta. A reprodução é uma página própria; tela cheia é responsabilidade do player e retorna por Esc.

# Do's and Don'ts

**Do:**
- Agrupar mensagens, preservar espaço vertical e dar feedback a toda ação relevante.
- Manter foco de teclado, labels e áreas de toque confortáveis.
- Usar animações curtas, com respeito a `prefers-reduced-motion`.
- Preservar IDs reais nas menções e compatibilidade com mensagens existentes.

**Don't:**
- Não adicionar gradientes, glow, métricas decorativas ou cards sem função.
- Não repetir avatar, nome e horário em mensagens consecutivas.
- Não usar emoji como ícone de interface nem esconder estados somente pela cor.
- Não trocar funcionalidade por limpeza visual.
