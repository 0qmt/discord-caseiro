const { exec } = require('node:child_process');

/**
 * O que está tocando agora, lido da central de mídia do Windows (SMTC - a
 * mesma coisa que aparece no controle de volume quando você aperta play).
 *
 * Ler dali, e não de cada app, é o que faz isso funcionar pro Spotify, pro
 * YouTube Music no navegador, pro YouTube comum e pra qualquer player que se
 * registre no sistema - sem precisar de token, login ou API de terceiro, e
 * sem depender de um app específico estar instalado.
 *
 * Só sai daqui título, artista e o nome do app tocando. Nada de caminho de
 * arquivo, playlist, biblioteca ou histórico.
 */

/**
 * O PowerShell abaixo alcança a API WinRT do Windows a partir do .NET, que
 * exige dois malabarismos:
 *
 * 1. `AsTask` pra transformar IAsyncOperation em algo que dá pra esperar - o
 *    PowerShell não tem `await`. Achamos o método por reflexão porque ele é
 *    genérico e sobrecarregado.
 * 2. A sintaxe `[Tipo,Assembly,ContentType=WindowsRuntime]` pra carregar o
 *    tipo WinRT; sem o ContentType o PowerShell não acha.
 *
 * Devolve uma linha JSON só, pra facilitar o parse do lado de cá.
 */
const SCRIPT = `
$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]
  function Await($op, $t) {
    $m = $asTask.MakeGenericMethod($t)
    $task = $m.Invoke($null, @($op))
    if (-not $task.Wait(4000)) { throw 'timeout' }
    $task.Result
  }
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media,ContentType=WindowsRuntime]
  $mgr = Await ($mgrType::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $s = $mgr.GetCurrentSession()
  if ($null -eq $s) { Write-Output 'null'; exit }
  $info = $s.GetPlaybackInfo()
  $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  @{
    titulo = [string]$props.Title
    artista = [string]$props.Artist
    album = [string]$props.AlbumTitle
    app = [string]$s.SourceAppUserModelId
    tocando = ($info.PlaybackStatus -eq 'Playing')
  } | ConvertTo-Json -Compress
} catch { Write-Output 'null' }
`;

/** App de mídia -> nome bonito. O resto entra com o próprio id, encurtado. */
const APPS = new Map(Object.entries({
  'spotify.exe': 'Spotify',
  'spotifyab.spotifymusic': 'Spotify',
  'chrome.exe': 'YouTube',
  'msedge.exe': 'YouTube',
  'brave.exe': 'YouTube',
  'firefox.exe': 'YouTube',
  'opera.exe': 'YouTube',
  'zen.exe': 'YouTube',
}));

/**
 * O app de origem vem como AppUserModelId, que pode ser tanto "Spotify.exe"
 * quanto um id enorme de app da Store. Encurta pro que dá pra mostrar.
 */
function nomeDoApp(bruto) {
  const id = String(bruto ?? '').trim();
  if (!id) return null;
  const chave = id.toLowerCase();
  for (const [prefixo, bonito] of APPS) {
    if (chave.includes(prefixo.replace('.exe', ''))) return bonito;
  }
  // Id da Store costuma ser "Publisher.App_hash!App" - fica com o miolo.
  const miolo = id.split('!')[0].split('.').pop().split('_')[0];
  return miolo.slice(0, 24) || null;
}

/**
 * Interpreta a saída do PowerShell.
 *
 * Separado da chamada em si pra dar pra testar sem depender de ter música
 * tocando na máquina - o caminho que mais quebra aqui é justamente o parse,
 * não o `exec`.
 */
function interpretar(saidaBruta) {
  const texto = String(saidaBruta ?? '').trim();
  if (!texto || texto === 'null') return null;
  try {
    const dado = JSON.parse(texto);
    // Pausado não conta: "parou pra almoçar" não é atividade pra mostrar.
    if (!dado?.titulo || !dado.tocando) return null;
    return {
      titulo: String(dado.titulo).slice(0, 80),
      artista: String(dado.artista ?? '').slice(0, 80) || null,
      app: nomeDoApp(dado.app),
    };
  } catch {
    return null;
  }
}

/**
 * Lê a mídia atual. Devolve null quando não tem nada tocando - inclusive
 * quando está pausado, porque "pausado" não é uma atividade que valha a
 * pena mostrar pros outros.
 */
function lerMusica() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    exec(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${SCRIPT.replace(/"/g, '\\"')}"`,
      { windowsHide: true, timeout: 9000, maxBuffer: 1024 * 256 },
      (erro, saida) => resolve(erro ? null : interpretar(saida)),
    );
  });
}

module.exports = { lerMusica, interpretar, nomeDoApp };
