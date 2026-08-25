import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

const NOME = 'Discord Caseiro';
const REPO = '0qmt/discord-caseiro';
// O instalador (~90 MB) vem direto do GitHub Releases, não do nosso servidor -
// senão cada download passaria pelo túnel caseiro e comeria a banda dele à toa.
const INSTALADOR_URL = `https://github.com/${REPO}/releases/latest/download/discord-caseiro-setup-latest.exe`;

/** Busca a versão publicada de verdade; se o GitHub não responder, some sem quebrar a página. */
function useVersaoPublicada() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!r) return;
        const exe = r.assets?.find((a) => a.name.endsWith('.exe') && !a.name.includes('blockmap'));
        setInfo({
          version: r.tag_name?.replace(/^v/, ''),
          size: exe ? `${(exe.size / 1024 / 1024).toFixed(0)} MB` : null,
        });
      })
      .catch(() => {});
  }, []);
  return info;
}

export default function App() {
  const versao = useVersaoPublicada();

  return (
    <div className="pagina">
      <header className="cabecalho">
        <div className="faixa">
          <a href="#top" className="marca">
            <Logo className="marca-logo" />
            <span>{NOME}</span>
          </a>
          <nav className="nav-desktop">
            <a href="#instalar">Como instalar</a>
          </nav>
          <a href="#download" className="botao botao-primario botao-pequeno">
            Baixar
          </a>
        </div>
      </header>

      <section id="top" className="hero">
        <div className="hero-glow hero-glow-a" />
        <div className="hero-glow hero-glow-b" />

        <div className="faixa hero-conteudo">
          <div className="hero-icone">
            <Logo className="hero-icone-img" />
          </div>

          <h1>
            Baixe o {NOME} para o seu <span className="destaque">computador</span>
          </h1>
          <p className="hero-sub">
            Leve, rápido e feito para curtir com a galera. Nada de conta empresarial,
            contrato ou letrinha miúda — só instalar e usar.
          </p>

          <div id="download" className="hero-botoes">
            <a href={INSTALADOR_URL} className="botao botao-primario botao-grande">
              <WindowsIcon />
              Baixar para Windows
            </a>
          </div>

          <p className="hero-versao">
            {versao ? `Versão ${versao.version}${versao.size ? ` · ${versao.size}` : ''}` : 'Versão mais recente'}
            {' · Só disponível para Windows por enquanto'}
          </p>
        </div>
      </section>

      <section id="instalar" className="secao secao-alternativa">
        <div className="faixa">
          <h2 className="titulo-secao">Como instalar</h2>
          <div className="grade-passos">
            <Passo n={1} titulo="Baixa o arquivo" texto="Clica no botão de baixar. É rapidinho." />
            <Passo
              n={2}
              titulo="Ignora o aviso"
              texto='Se aparecer "app desconhecido", clica em mais informações e executar. É de amigo, não de hacker.'
            />
            <Passo n={3} titulo="Entra e chama a galera" texto="Abre o app, cria teu apelido e manda o link no grupo." />
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="cta-glow" />
        <div className="cta-conteudo">
          <Logo className="cta-logo" />
          <h2>Vamo lá, é um clique</h2>
          <a href={INSTALADOR_URL} className="botao botao-primario botao-grande">
            Baixar o {NOME}
          </a>
        </div>
      </section>
    </div>
  );
}

function Passo({ n, titulo, texto }) {
  return (
    <div className="card-passo">
      <span className="card-passo-numero">{n}</span>
      <h3>{titulo}</h3>
      <p>{texto}</p>
    </div>
  );
}

function WindowsIcon({ tamanho = 20 }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={tamanho} height={tamanho}>
      <path d="M3 5.6l7.4-1v7.1H3V5.6zm0 12.8l7.4 1v-7h-7.4v6zM11.6 4.4L21 3v8.7h-9.4V4.4zm0 15.2L21 21v-8.6h-9.4v7.2z" />
    </svg>
  );
}
