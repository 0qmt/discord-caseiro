const TOQUE_PADRAO = 'padrao';
const TOQUE_SIRENE = 'sirene';

/** A ponte nunca transforma texto da página em caminho ou URL de arquivo. */
function normalizarToqueDeChamada(valor) {
  return valor === TOQUE_SIRENE ? TOQUE_SIRENE : TOQUE_PADRAO;
}

module.exports = { TOQUE_PADRAO, TOQUE_SIRENE, normalizarToqueDeChamada };
