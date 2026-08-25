import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { NOMES_DE_PERMISSAO, PERM } from '../lib/cargos.js';

const CORES = [
  '#f23f43', '#e67e22', '#f0b232', '#23a559', '#1abc9c',
  '#3498db', '#5865f2', '#9b59b6', '#e91e63', '#95a5a6',
];

/**
 * Cargos: criar, colorir, marcar permissões e apagar.
 *
 * Não deixa mexer no bit de administrador do @everyone porque isso
 * transformaria o servidor inteiro em dono - o servidor recusa de qualquer
 * jeito, mas esconder o botão evita a pessoa tentar e achar que quebrou.
 *
 * Mora como seção (e não mais como modal próprio) porque agora vive dentro
 * das configurações do servidor, junto de membros, banimentos e o resto.
 */
export default function SecaoCargos({ guild, onErro }) {
  const [roles, setRoles] = useState(guild.roles ?? []);
  const [selecionadoId, setSelecionadoId] = useState(guild.roles?.[0]?.id ?? null);
  const [salvando, setSalvando] = useState(false);

  const selecionado = roles.find((r) => r.id === selecionadoId) ?? null;

  useEffect(() => {
    api.listRoles(guild.id)
      .then(({ roles: lista }) => {
        setRoles(lista);
        setSelecionadoId((atual) => (lista.some((r) => r.id === atual) ? atual : lista[0]?.id ?? null));
      })
      .catch(() => {});
  }, [guild.id]);

  /** Guarda local na hora e manda pro servidor - a lista não pisca. */
  async function salvar(mudanca) {
    if (!selecionado) return;
    const otimista = { ...selecionado, ...mudanca };
    setRoles((prev) => prev.map((r) => (r.id === otimista.id ? otimista : r)));
    setSalvando(true);
    try {
      const { role } = await api.updateRole(guild.id, selecionado.id, mudanca);
      setRoles((prev) => prev.map((r) => (r.id === role.id ? role : r)));
    } catch (err) {
      onErro?.(err.message);
      // Volta ao que era: o servidor recusou.
      setRoles((prev) => prev.map((r) => (r.id === selecionado.id ? selecionado : r)));
    } finally {
      setSalvando(false);
    }
  }

  async function criar() {
    try {
      const { role } = await api.createRole(guild.id, { name: 'Cargo novo', color: CORES[6] });
      setRoles((prev) => [role, ...prev]);
      setSelecionadoId(role.id);
    } catch (err) { onErro?.(err.message); }
  }

  async function apagar() {
    if (!selecionado || selecionado.isDefault) return;
    try {
      await api.deleteRole(guild.id, selecionado.id);
      setRoles((prev) => prev.filter((r) => r.id !== selecionado.id));
      setSelecionadoId(null);
    } catch (err) { onErro?.(err.message); }
  }

  const alternarPermissao = (bit) => {
    const atual = selecionado.permissions;
    salvar({ permissions: (atual & bit) ? (atual & ~bit) : (atual | bit) });
  };

  return (
    <section className="settings-secao larga">
      <h2>Cargos</h2>
      <p className="settings-subtitulo">
        Use cargos pra agrupar gente e dar permissões de uma vez. Quem tem um cargo
        acima na lista manda em quem tem cargo abaixo.
      </p>
      <div className="cargos-layout">
        <div className="cargos-lista">
          <button className="cargos-novo" onClick={criar}>+ Criar cargo</button>
          {roles.map((r) => (
            <button
              key={r.id}
              className={`cargos-item ${r.id === selecionadoId ? 'ativo' : ''}`}
              onClick={() => setSelecionadoId(r.id)}
            >
              <span className="cargos-bolinha" style={{ background: r.color ?? '#99aab5' }} />
              <span className="cargos-nome">{r.name}</span>
            </button>
          ))}
        </div>

        <div className="cargos-detalhe">
          {!selecionado ? (
            <p className="hint">Escolhe um cargo na lista pra editar.</p>
          ) : (
            <>
              <label>
                Nome
                <input
                  value={selecionado.name}
                  disabled={selecionado.isDefault}
                  onChange={(e) => setRoles((prev) =>
                    prev.map((r) => (r.id === selecionado.id ? { ...r, name: e.target.value } : r)))}
                  onBlur={(e) => salvar({ name: e.target.value })}
                  maxLength={32}
                />
              </label>

              {!selecionado.isDefault && (
                <>
                  <span className="campo-rotulo">Cor</span>
                  <div className="cargos-cores">
                    {CORES.map((c) => (
                      <button
                        key={c}
                        className={`cargos-cor ${selecionado.color === c ? 'ativa' : ''}`}
                        style={{ background: c }}
                        title={c}
                        onClick={() => salvar({ color: c })}
                      />
                    ))}
                    <button
                      className={`cargos-cor sem ${!selecionado.color ? 'ativa' : ''}`}
                      title="Sem cor"
                      onClick={() => salvar({ color: null })}
                    >
                      /
                    </button>
                  </div>
                </>
              )}

              <span className="campo-rotulo">Permissões</span>
              <div className="cargos-permissoes">
                {NOMES_DE_PERMISSAO.map(([bit, nome]) => {
                  // O @everyone é a base de todo mundo: deixar ele virar
                  // administrador daria poder de dono pro servidor inteiro.
                  const proibido = selecionado.isDefault && bit === PERM.ADMINISTRADOR;
                  return (
                    <label className="checkbox" key={nome}>
                      <input
                        type="checkbox"
                        checked={(selecionado.permissions & bit) !== 0}
                        disabled={proibido || salvando}
                        onChange={() => alternarPermissao(bit)}
                      />
                      {nome}
                      {proibido && <span className="hint"> — não vale pro @everyone</span>}
                    </label>
                  );
                })}
              </div>

              {!selecionado.isDefault && (
                <button className="perigo-link" onClick={apagar}>Apagar este cargo</button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
