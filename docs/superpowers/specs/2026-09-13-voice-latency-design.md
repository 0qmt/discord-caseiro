# Latencia da chamada de voz

## Objetivo

Exibir durante uma chamada a latência observada no caminho WebRTC de mídia,
para que a pessoa saiba quando a conexão está boa ou instável sem gerar
requisições extras ao servidor.

## Desenho

O cliente já mantém uma `RTCPeerConnection` por participante em
`client/src/lib/voice.js`. A cada dois segundos, enquanto houver chamada,
cada conexão ativa será consultada com `RTCPeerConnection.getStats()` e será
extraído `candidate-pair.currentRoundTripTime`, convertido de segundos para
milissegundos. O estado publicado para a interface terá a latência por peer e
um resumo da chamada.

O resumo mostrará a média das medições válidas e a maior latência entre os
participantes conectados. Com uma pessoa, os dois valores são iguais. Sem
medição disponível, a interface mostrará `Ping: --`.

## Interface e qualidade

O `VoicePanel` exibirá `Ping: N ms` próximo ao estado da chamada. A classe de
qualidade será verde até 100 ms, amarela de 101 a 200 ms e vermelha acima de
200 ms. A mensagem de qualidade é apenas informativa e não altera o áudio.

## Segurança e compatibilidade

Nenhum dado será enviado ao servidor e nenhum URL será criado a partir das
estatísticas. Conexões fechadas, falhas de `getStats()` e navegadores sem o
relatório esperado serão ignorados sem interromper a chamada. A medição será
cancelada ao sair da call ou destruir o cliente.

## Testes

- validar conversão de RTT e resumo com zero, um e vários participantes;
- validar limites de 100 e 200 ms;
- validar ausência de candidate pair, peer desconectado e erro de `getStats()`;
- rodar os testes existentes do cliente e o build de produção.
