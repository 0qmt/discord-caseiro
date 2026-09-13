# Acesso direto gratuito pelo DuckDNS

## Objetivo

Remover o Tailscale Funnel do caminho normal do Discordia para reduzir a
latência da interface e da sinalização, mantendo HTTPS, custo zero e suporte a
IP residencial dinâmico.

## Arquitetura

O domínio `discord-caseiro.duckdns.org` continuará sendo atualizado pelo
serviço DuckDNS existente. A porta pública 3001 continuará apontando para a
porta 3001 do Umbrel, portanto nenhuma nova regra do roteador será necessária.

No Umbrel, o servidor Node deixará de publicar diretamente a porta 3001 e
ficará acessível apenas em `127.0.0.1:3002`. Um Caddy local ouvirá HTTPS na
porta 3001 e encaminhará HTTP/WebSocket para `127.0.0.1:3002`.

O certificado será emitido e renovado automaticamente por DNS-01 usando o
módulo oficial comunitário `caddy-dns/duckdns`. O token virá do arquivo de
ambiente já ignorado pelo Git e nunca será incluído no Caddyfile ou na imagem.

## Chamadas

O túnel afeta apenas página, API e sinalização. O áudio e o vídeo continuam em
WebRTC: conexão direta quando possível e Coturn UDP/TCP quando necessário. O
Coturn deve iniciar junto com o compose e anunciar o IP público atual.

## Migração

O Caddy será validado primeiro em uma porta temporária. Depois, servidor e
proxy serão trocados juntos. Os clientes passarão a usar exclusivamente
`https://discord-caseiro.duckdns.org:3001`. O Tailscale permanecerá ativo como
acesso de reserva durante a validação, mas não será candidato automático do
app.

## Verificação

- certificado e hostname válidos;
- `/api/health` e Socket.IO respondendo por HTTPS direto;
- acesso externo por múltiplas regiões;
- Coturn ativo e respondendo em UDP 3478;
- build web, APK e desktop;
- aplicativo sem seletor de servidor e com repetição automática de conexão;
- release nova com metadados e assinaturas válidos.
