param(
    [long]$RunId = 0,
    [string]$Servidor = 'umbrel@192.168.0.56',
    [string]$DiretorioRemoto = '/home/umbrel/discord-caseiro/data/mobile-updates'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content (Join-Path $repo 'client/package.json') -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') {
    throw "Versao Android precisa usar major.minor.patch: $version"
}
$versionCode = ([int]$Matches[1] * 1000000) + ([int]$Matches[2] * 1000) + [int]$Matches[3]
$head = (git -C $repo rev-parse HEAD).Trim()

if (-not $RunId) {
    $runs = gh run list --repo 0qmt/discord-caseiro --workflow 'Android APK' --commit $head `
        --status success --limit 1 --json databaseId,headSha | ConvertFrom-Json
    if (-not $runs -or $runs[0].headSha -ne $head) {
        throw "Nao existe build Android bem-sucedida para o commit $head."
    }
    $RunId = $runs[0].databaseId
}

$run = gh run view $RunId --repo 0qmt/discord-caseiro --json conclusion,headSha | ConvertFrom-Json
if ($run.conclusion -ne 'success' -or $run.headSha -ne $head) {
    throw 'O workflow precisa estar concluido com sucesso e pertencer ao HEAD atual.'
}

$tempRoot = Join-Path $env:SystemDrive 'Temp'
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
$temp = Join-Path $tempRoot "discordia-android-$RunId"
if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp | Out-Null

try {
    gh run download $RunId --repo 0qmt/discord-caseiro --name discordia-android-release --dir $temp
    if ($LASTEXITCODE) { throw 'Falha ao baixar o artefato do GitHub Actions.' }
    $sourceApk = Join-Path $temp 'app-release.apk'
    if (-not (Test-Path $sourceApk)) { throw 'APK release nao encontrado no artefato.' }

    $sdkCandidates = @($env:ANDROID_HOME, 'D:\android\sdk', (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) |
        Where-Object { $_ -and (Test-Path (Join-Path $_ 'build-tools')) }
    $sdk = $sdkCandidates | Select-Object -First 1
    if (-not $sdk) { throw 'Android SDK nao encontrado.' }
    $buildTools = Get-ChildItem (Join-Path $sdk 'build-tools') -Directory |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $buildTools) { throw 'Android build-tools nao encontrado.' }
    $aapt = Join-Path $buildTools.FullName 'aapt.exe'
    $apksigner = Join-Path $buildTools.FullName 'apksigner.bat'

    $badging = (& $aapt dump badging $sourceApk | Select-Object -First 1 | Out-String).Trim()
    if ($LASTEXITCODE -or $badging -notmatch "name='com\.discordcaseiro\.app'") {
        throw 'Package name inesperado no APK.'
    }
    if ($badging -notmatch "versionCode='$versionCode'" -or $badging -notmatch "versionName='$([regex]::Escape($version))'") {
        throw "APK nao corresponde a versao $version ($versionCode)."
    }
    & $apksigner verify --verbose --print-certs $sourceApk
    if ($LASTEXITCODE) { throw 'Assinatura do APK invalida.' }

    $signingDir = Join-Path $env:USERPROFILE '.discordia-signing'
    $keyStore = Join-Path $signingDir 'discordia-android-release.p12'
    $passwordFile = Join-Path $signingDir 'android-signing-password.clixml'
    if (-not (Test-Path $keyStore) -or -not (Test-Path $passwordFile)) {
        throw 'Chave release local nao encontrada; publicacao recusada.'
    }
    $secure = Import-Clixml $passwordFile
    $credential = [pscredential]::new('discordia', $secure)
    $password = $credential.GetNetworkCredential().Password
    $certificate = Join-Path $temp 'signer.cer'
    & keytool -exportcert -alias discordia -keystore $keyStore -storetype PKCS12 `
        -storepass $password -file $certificate | Out-Null
    if ($LASTEXITCODE) { throw 'Nao foi possivel ler o certificado release local.' }
    $expectedSigner = (Get-FileHash $certificate -Algorithm SHA256).Hash.ToLowerInvariant()
    $signerOutput = (& $apksigner verify --print-certs $sourceApk | Out-String)
    if ($signerOutput -notmatch '(?:Signer #1 certificate|V2 Signer: certificate) SHA-256 digest: ([a-fA-F0-9]+)') {
        throw 'Fingerprint da assinatura do APK nao encontrado.'
    }
    if ($Matches[1].ToLowerInvariant() -ne $expectedSigner) {
        throw 'APK foi assinado por uma chave diferente da chave release oficial.'
    }

    $apkName = "discordia-$version.apk"
    $apk = Join-Path $temp $apkName
    Move-Item -LiteralPath $sourceApk -Destination $apk
    $sha256 = (Get-FileHash $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item $apk).Length
    $manifest = [ordered]@{
        schemaVersion = 1
        packageName = 'com.discordcaseiro.app'
        versionName = $version
        versionCode = $versionCode
        minSdk = 26
        url = "/mobile-updates/$apkName"
        sha256 = $sha256
        size = $size
        publishedAt = [DateTime]::UtcNow.ToString('o')
    }
    $manifestPath = Join-Path $temp 'latest.json'
    $utf8SemBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), $utf8SemBom)

    $remoteApkTemp = "$DiretorioRemoto/.$apkName.uploading"
    $remoteManifestTemp = "$DiretorioRemoto/.latest.json.uploading"
    ssh $Servidor "mkdir -p '$DiretorioRemoto' && rm -f '$remoteApkTemp' '$remoteManifestTemp'"
    if ($LASTEXITCODE) { throw 'Falha ao preparar diretorio no Umbrel.' }
    $currentRaw = (ssh $Servidor "cat '$DiretorioRemoto/latest.json' 2>/dev/null || true" | Out-String).Trim()
    if ($currentRaw) {
        $current = $currentRaw | ConvertFrom-Json
        if ([long]$current.versionCode -ge $versionCode) {
            throw "Publicacao recusada: servidor ja possui versionCode $($current.versionCode)."
        }
    }
    scp $apk "${Servidor}:$remoteApkTemp"
    if ($LASTEXITCODE) { throw 'Falha no upload do APK.' }
    scp $manifestPath "${Servidor}:$remoteManifestTemp"
    if ($LASTEXITCODE) { throw 'Falha no upload do manifesto.' }

    $remoteSize = (ssh $Servidor "stat -c%s '$remoteApkTemp'").Trim()
    if ($LASTEXITCODE) { throw 'Falha ao validar o tamanho do APK remoto.' }
    $remoteHashLine = (ssh $Servidor "sha256sum '$remoteApkTemp'").Trim()
    if ($LASTEXITCODE) { throw 'Falha ao validar o SHA-256 do APK remoto.' }
    $remoteHash = ($remoteHashLine -split '\s+')[0]
    if ([long]$remoteSize -ne $size -or $remoteHash -ne $sha256) {
        throw 'Tamanho ou SHA-256 do APK remoto nao confere.'
    }

    # O manifesto e movido por ultimo: ele e o ponteiro atomico para a versao atual.
    ssh $Servidor "mv -f '$remoteApkTemp' '$DiretorioRemoto/$apkName' && mv -f '$remoteManifestTemp' '$DiretorioRemoto/latest.json'"
    if ($LASTEXITCODE) { throw 'Falha ao ativar a atualizacao no Umbrel.' }

    $latestTag = (gh release view --repo 0qmt/discord-caseiro --json tagName --jq '.tagName').Trim()
    if (-not $latestTag) { throw 'Nao foi possivel descobrir a release mais recente no GitHub.' }
    $latestAlias = Join-Path $temp 'discordia-android-latest.apk'
    Copy-Item -LiteralPath $apk -Destination $latestAlias -Force
    gh release upload $latestTag $apk $latestAlias --repo 0qmt/discord-caseiro --clobber
    if ($LASTEXITCODE) { throw "Falha ao enviar APK para o GitHub Release $latestTag." }

    Write-Host "Android $version publicado: $apkName ($size bytes, SHA-256 $sha256)"
} finally {
    if (Test-Path $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
