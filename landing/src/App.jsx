import { useEffect, useState } from 'react';
import Logo from './Logo.jsx';

const NOME = 'Discord Caseiro';
const REPO = '0qmt/discord-caseiro';
// Downloads publicos ficam no GitHub Releases para nao depender de porta residencial.
const INSTALADOR_URL = `https://github.com/${REPO}/releases/latest/download/discord-caseiro-setup-latest.exe`;
const ANDROID_URL = `https://github.com/${REPO}/releases/latest/download/discordia-android-latest.apk`;

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

function useVersaoAndroid() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (!r) return;
        const apk = r.assets?.find((a) => a.name === 'discordia-android-latest.apk')
          ?? r.assets?.find((a) => a.name.endsWith('.apk'));
        const versao = apk?.name?.match(/(\d+\.\d+\.\d+)\.apk$/)?.[1];
        setInfo({
          version: versao ?? 'mais recente',
          size: apk?.size ? `${(apk.size / 1024 / 1024).toFixed(1)} MB` : null,
        });
      })
      .catch(() => {});
  }, []);
  return info;
}

export default function App() {
  const versao = useVersaoPublicada();
  const android = useVersaoAndroid();

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
            Baixe o {NOME} nos seus <span className="destaque">dispositivos</span>
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
            <a href={ANDROID_URL} className="botao botao-secundario botao-grande">
              <AndroidIcon />
              Baixar APK Android
            </a>
          </div>

          <p className="hero-versao">
            Windows {versao ? `${versao.version}${versao.size ? ` · ${versao.size}` : ''}` : 'mais recente'}
            {' · Android '}
            {android ? `${android.version}${android.size ? ` · ${android.size}` : ''}` : 'mais recente'}
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
              titulo="Confirma a instalação"
              texto="No Android, permita a instalação desta fonte quando o sistema pedir. No Windows, confirme a execução do instalador."
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
          <div className="cta-botoes">
            <a href={INSTALADOR_URL} className="botao botao-primario botao-grande">
              <WindowsIcon /> Windows
            </a>
            <a href={ANDROID_URL} className="botao botao-secundario botao-grande">
              <AndroidIcon /> Android
            </a>
          </div>
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

function AndroidIcon({ tamanho = 20 }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={tamanho} height={tamanho} aria-hidden="true">
      <path d="M8.2 5.2 6.8 2.8a.75.75 0 0 1 1.3-.75l1.47 2.55A8.7 8.7 0 0 1 12 4.25c.84 0 1.66.12 2.43.35l1.47-2.55a.75.75 0 1 1 1.3.75l-1.4 2.4A7.4 7.4 0 0 1 19.5 11H4.5a7.4 7.4 0 0 1 3.7-5.8ZM8.5 8.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM4.5 12.5h15V19a2 2 0 0 1-2 2h-1v1.25a.75.75 0 0 1-1.5 0V21H9v1.25a.75.75 0 0 1-1.5 0V21h-1a2 2 0 0 1-2-2v-6.5Z" />
    </svg>
  );
}
