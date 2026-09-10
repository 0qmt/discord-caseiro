# Area do usuario no mobile

## Objetivo

Substituir a tela de configuracoes desktop comprimida no celular por um fluxo
mobile de tela cheia. O desktop preserva sua navegacao atual; Android e web em
viewport estreito usam a nova composicao.

## Navegacao

O fluxo possui tres niveis:

1. Perfil do usuario, com identidade, status, bio, data de entrada e acesso a
   edicao e configuracoes.
2. Inicio de configuracoes, com busca e grupos verticais.
3. Pagina dedicada para conta, voz e video, notificacoes, aparencia, servidor
   (quando permitido) e sobre.

O voltar do Android e o botao visual retiram um nivel da pilha. No primeiro
nivel, fecham a area do usuario e devolvem a pessoa ao contexto anterior do
app.

## Reuso funcional

As paginas mobile reutilizam as implementacoes existentes de mudanca de senha,
preferencias de audio, notificacoes, temas, administracao e informacoes de
versao. Nao serao exibidas categorias sem funcionalidade real. Editar perfil
continua usando o editor canonico do app.

## Sistema visual

- Fundo carvao neutro, superficies discretas e azul apenas para selecao e
  acoes principais.
- Cabecalho compacto e fixo, sem texto de teclado ou botao circular gigante.
- Margens laterais de 16 px, alvos de toque de no minimo 44 px, grupos com
  divisores internos e tipografia de escala consistente.
- `100dvh` e safe areas de topo e rodape em todas as telas.
- Sem tabs horizontais, scrollbar horizontal ou identidade duplicada.
- Transicao horizontal curta entre os niveis, desativada quando o sistema pede
  movimento reduzido.

## Busca

A busca do inicio filtra as categorias reais por nome e termos relacionados.
Cada resultado abre diretamente a pagina correspondente.

## Criterios de aceite

- Perfil e configuracoes sao telas diferentes.
- Categorias abrem paginas dedicadas e o voltar funciona em todos os niveis.
- Conta contem e-mail e senha; perfil nao mostra e-mail.
- Logout fica no fim das configuracoes e continua pedindo confirmacao.
- Nao existem tabs ou barras horizontais no mobile.
- A interface nao colide com as barras de sistema e continua utilizavel com o
  teclado aberto.
- Todas as funcoes existentes permanecem acessiveis.
- O layout desktop e seus comportamentos nao mudam.
