# Volume individual com desbloqueio ate 400%

Date: 2026-09-23

## Objetivo

Corrigir o controle de volume individual das chamadas para que valores acima de
100% amplifiquem de verdade o audio recebido, sem alterar o volume enviado pela
pessoa nem o que os demais participantes ouvem.

O fluxo normal continua limitado a 200%. O limite de 400% so fica disponivel
depois de uma acao deliberada e de uma confirmacao explicita.

## Experiencia do controle

O menu de contexto do participante continua abrindo o controle `Volume` entre
0% e 200%, com 100% como valor inicial. Enquanto o valor for menor que 200%, o
menu nao ganha novas acoes.

Ao chegar exatamente a 200%, aparece abaixo do controle o botao `Ta pouco?`.
Acionar esse botao abre uma confirmacao informando que:

- o modo amplificado pode deixar o som muito alto e distorcido;
- o usuario deve reduzir o volume fisico antes de confirmar;
- a liberacao vale apenas para aquele participante durante a sessao atual.

Depois da confirmacao, o maximo do controle passa a 400% e o valor permanece em
200%; o sistema nunca salta automaticamente para 400%. A pessoa escolhe o novo
nivel arrastando o controle. O menu identifica os valores acima de 200% como
`Amplificado` e oferece `Voltar ao limite de 200%`, que reduz imediatamente um
valor maior para 200% e bloqueia novamente a faixa extra.

Silenciar so para mim e ensurdecer continuam tendo prioridade e produzem ganho
zero independentemente do limite desbloqueado.

## Arquitetura de audio

O elemento HTML de audio limita `volume` ao intervalo de 0 a 1 e hoje corta
qualquer valor maior que 100%. A reproducao de cada participante passara por um
grafo Web Audio exclusivo:

`MediaStream remoto -> GainNode -> saida de audio`

O valor escolhido sera convertido diretamente em ganho linear:

- 0% = `0.0`;
- 100% = `1.0`;
- 200% = `2.0`;
- 400% = `4.0`.

Assim, 400% significa ganho real `4.0` antes da saida do dispositivo, e nao
apenas um rotulo visual. Nao sera aplicado compressor que reduza silenciosamente
esse ganho. Sinais que ja chegam altos podem clipar e distorcer, comportamento
que a confirmacao deixa explicito.

Cada participante tera somente um caminho audivel. Quando o grafo Web Audio
estiver ativo, o elemento HTML nao podera reproduzir uma segunda copia do mesmo
som. Mudanca de stream, saida de audio, saida da chamada e desmontagem do
componente devem desconectar os nos e liberar os recursos anteriores.

## Compatibilidade e falhas

O recurso usara deteccao de capacidade. No Electron/Chromium, o contexto de
audio devera respeitar a saida selecionada quando `AudioContext.setSinkId`
estiver disponivel. Em navegadores sem essa API, a reproducao continua na saida
padrao do sistema.

Se Web Audio nao puder ser criado ou retomado, o participante continua audivel
pelo elemento HTML no intervalo seguro de 0% a 100%. A interface nao deve
afirmar que 200% ou 400% esta ativo quando o ganho real nao puder ser aplicado.
Uma interacao de clique ou teclado deve retomar um contexto suspenso pelas
regras de autoplay do navegador.

O desbloqueio de 400% e local, por participante e mantido apenas em memoria. Ele
nao vai para o servidor, nao afeta outros clientes e e perdido ao recarregar o
aplicativo ou sair da sessao.

## Componentes afetados

- `ContextMenu`: permite uma acao condicional junto ao slider e exibe o estado
  amplificado sem fechar o menu durante o ajuste.
- `App`: controla a confirmacao e o desbloqueio local por participante.
- `VoiceClient`: aceita e expoe valores de 0 a 4 somente quando o participante
  estiver desbloqueado, mantendo mute e deafen como ganho zero.
- `VoiceAudioSink`/`Media`: cria, atualiza e desmonta o grafo Web Audio sem
  duplicar a reproducao.
- Configuracao de saida: aplica o dispositivo escolhido ao contexto quando a
  plataforma suportar isso e preserva o fallback atual.

## Validacao

- Teste unitario da conversao 0%, 100%, 200% e 400% para ganhos 0, 1, 2 e 4.
- Teste do limite: antes da confirmacao, nenhum valor maior que 2 e aceito;
  depois dela, 4 e aceito; ao bloquear novamente, valores acima de 2 caem para
  2.
- Teste do fluxo do menu: `Ta pouco?` aparece somente em 200%, cancelar mantem
  o limite e confirmar libera 400% sem mudar o valor atual.
- Teste de mute/deafen em 400%, garantindo ganho zero e restauracao do valor
  anterior ao voltar a ouvir.
- Teste de troca de participante e reconexao, garantindo um unico caminho de
  audio e ausencia de vazamento de nos ou contextos.
- Build de producao do cliente.
- Teste manual com duas contas no Electron: comparar 100%, 200% e 400%, validar
  distorcao esperada em fonte alta, saida de audio escolhida e ausencia de eco.

## Fora de escopo

- Amplificar o microfone local antes de envia-lo.
- Alterar o volume para todos os participantes.
- Persistir a liberacao de 400% entre reinicios.
- Fazer deploy no Umbrel antes da validacao local e da aprovacao da versao de
  teste.
