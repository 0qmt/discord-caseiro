import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { cropStyle } from '../lib/cropStyle.js';
import { detectImageKind } from '../lib/imageKind.js';
import Avatar from './Avatar.jsx';
import Modal from './Modal.jsx';

const MAX_MB = 20;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/**
 * Recorta imagem parada num canvas e devolve um arquivo pequeno.
 * Imagem animada nao passa por aqui: o canvas so copia o primeiro quadro.
 */
async function cropStaticImage(src, areaPixels, width, height) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    img,
    areaPixels.x, areaPixels.y, areaPixels.width, areaPixels.height,
    0, 0, width, height,
  );

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92))
    ?? await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], 'recorte.webp', { type: blob.type });
}

/**
 * Modal de recorte usado tanto pelo avatar (quadrado, redondo) quanto pelo
 * banner (retangular). `onUpload` recebe o arquivo e, quando animado, o
 * recorte em porcentagem pra ser aplicado na exibicao.
 *
 * Tem três etapas: escolher o arquivo, ajustar o recorte, e uma prévia final
 * — exatamente como vai aparecer no app — antes de confirmar o salvamento.
 * Remover a imagem atual também pede confirmação, sem sair do modal.
 */
export default function ImageCropModal({
  title,
  aspect = 1,
  cropShape = 'round',
  output = { width: 256, height: 256 },
  hasCurrent = false,
  currentPreview = null,
  onUpload,
  onRemove,
  onClose,
}) {
  const [file, setFile] = useState(null);
  const [kind, setKind] = useState(null);
  const [preview, setPreview] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areas, setAreas] = useState(null);
  const [etapa, setEtapa] = useState('recorte');   // 'recorte' | 'previa'
  const [arquivoFinal, setArquivoFinal] = useState(null);
  const [previaUrl, setPreviaUrl] = useState(null);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [processando, setProcessando] = useState(false);
  const inputRef = useRef(null);

  const isAnimated = kind?.animated === true;
  const ehAvatar = cropShape === 'round';

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { if (previaUrl) URL.revokeObjectURL(previaUrl); }, [previaUrl]);

  async function pickFile(event) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    if (chosen.size > MAX_MB * 1024 * 1024) {
      setError(`o arquivo passa de ${MAX_MB} MB`);
      return;
    }

    const detected = await detectImageKind(chosen);
    if (!detected) {
      setError('formato nao suportado (use png, jpg, webp ou gif)');
      return;
    }

    if (preview) URL.revokeObjectURL(preview);
    setError(null);
    setFile(chosen);
    setKind(detected);
    setPreview(URL.createObjectURL(chosen));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setEtapa('recorte');
  }

  /** Sai do ajuste de recorte pra prévia final — só aí é que existe "salvar". */
  async function irParaPrevia() {
    if (!file || !areas) return;
    setProcessando(true);
    setError(null);
    try {
      if (!isAnimated) {
        const cortada = await cropStaticImage(preview, areas.pixels, output.width, output.height);
        if (previaUrl) URL.revokeObjectURL(previaUrl);
        setArquivoFinal(cortada);
        setPreviaUrl(URL.createObjectURL(cortada));
      }
      setEtapa('previa');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessando(false);
    }
  }

  async function salvar() {
    setBusy(true);
    setError(null);
    try {
      if (isAnimated) {
        await onUpload(file, areas.percent);
      } else {
        await onUpload(arquivoFinal, null);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function confirmarRemocao() {
    setBusy(true);
    try {
      await onRemove();
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setConfirmandoRemocao(false);
    }
  }

  // --------------------------- nada escolhido ainda --------------------------

  if (!preview) {
    if (confirmandoRemocao) {
      return (
        <Modal title={title} onClose={onClose}>
          <p className="hint">Remover a imagem atual? Não tem como desfazer depois.</p>
          <div className="modal-actions">
            <button onClick={() => setConfirmandoRemocao(false)} disabled={busy}>Cancelar</button>
            <button className="primary perigo" onClick={confirmarRemocao} disabled={busy}>
              {busy ? 'Removendo...' : 'Remover'}
            </button>
          </div>
          {error && <div className="auth-error">{error}</div>}
        </Modal>
      );
    }

    return (
      <Modal title={title} onClose={onClose}>
        <div className="avatar-empty">
          {currentPreview}
          <p className="hint">PNG, JPG, WEBP ou GIF animado, até {MAX_MB} MB.</p>
          <button className="primary" onClick={() => inputRef.current?.click()}>
            Escolher imagem
          </button>
          {hasCurrent && (
            <button className="danger-link" onClick={() => setConfirmandoRemocao(true)}>
              Remover a atual
            </button>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={pickFile}
        />
      </Modal>
    );
  }

  // -------------------------------- prévia final ------------------------------

  if (etapa === 'previa') {
    const usuarioPrevia = {
      avatarUrl: isAnimated ? preview : previaUrl,
      avatarCrop: isAnimated ? areas.percent : null,
      username: '',
    };

    return (
      <Modal title={title} onClose={onClose}>
        <p className="hint">É assim que vai aparecer:</p>

        {ehAvatar ? (
          <div className="previa-avatar">
            <Avatar user={usuarioPrevia} size={160} />
          </div>
        ) : (
          <div className="profile-banner preview">
            <img
              src={isAnimated ? preview : previaUrl}
              alt=""
              style={isAnimated ? cropStyle(areas.percent) : undefined}
            />
          </div>
        )}

        {isAnimated && (
          <p className="hint small">
            {kind.ext.toUpperCase()} animado: a animação vai ser preservada.
          </p>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <button onClick={() => setEtapa('recorte')} disabled={busy}>Voltar</button>
          <button className="primary" onClick={salvar} disabled={busy}>
            {busy ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </Modal>
    );
  }

  // -------------------------------- ajustar recorte ---------------------------

  return (
    <Modal title={title} onClose={onClose}>
      <div className="cropper">
        <Cropper
          image={preview}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape={cropShape}
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(percent, pixels) => setAreas({ percent, pixels })}
        />
      </div>

      <label className="zoom">
        Zoom
        <input
          type="range" min={1} max={4} step={0.01}
          value={zoom} onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>

      {isAnimated && (
        <p className="hint small">
          {kind.ext.toUpperCase()} animado: a animação vai ser preservada.
        </p>
      )}

      {error && <div className="auth-error">{error}</div>}

      <div className="modal-actions">
        <button onClick={() => inputRef.current?.click()} disabled={processando}>Trocar</button>
        <button className="primary" onClick={irParaPrevia} disabled={processando || !areas}>
          {processando ? 'Processando...' : 'Continuar'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={pickFile}
      />
    </Modal>
  );
}
