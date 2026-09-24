# Plano de implementação: sirene exclusiva em convites

1. Criar uma regra pura no servidor que converte qualquer pedido de toque em
   `padrao`, exceto quando a conta corresponde à ID configurada e pediu
   explicitamente `sirene`.
2. Expor para a própria conta somente a capacidade booleana
   `specialCallSound`, sem revelar a ID configurada.
3. Persistir localmente o checkbox do remetente e incluí-lo nos três caminhos
   existentes que chamam alguém para uma call.
4. Propagar o toque sanitizado no evento `voice:convite` e encerrar o convite
   em todos os dispositivos do destinatário quando ele responder.
5. Empacotar `dog-siren.mp3` no desktop e limitar a ponte Electron aos
   identificadores `padrao` e `sirene`.
6. Cobrir preferência, autorização, fallback e ponte com testes; executar os
   testes existentes e os builds de produção sem fazer deploy.
