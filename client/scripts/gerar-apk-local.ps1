param(
  [switch]$Release
)

$ErrorActionPreference = 'Stop'
$clientRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $clientRoot 'android'
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { 'D:\android\sdk' }
$javaRoot = 'C:\Program Files\Amazon Corretto\jdk21.0.10_7'
$tempRoot = 'C:\Temp\discordia-gradle'

if (-not (Test-Path (Join-Path $sdkRoot 'platform-tools\adb.exe'))) {
  throw "Android SDK nao encontrado em $sdkRoot."
}
if (-not (Test-Path (Join-Path $javaRoot 'bin\java.exe'))) {
  throw "JDK 21 nao encontrado em $javaRoot."
}
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:JAVA_HOME = $javaRoot
$env:TEMP = $tempRoot
$env:TMP = $tempRoot

Push-Location $clientRoot
try {
  npm run build:android
  Push-Location $androidRoot
  try {
    $task = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat --no-daemon $task
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}

$variant = if ($Release) { 'release' } else { 'debug' }
$apk = Join-Path $androidRoot "app\build\outputs\apk\$variant\app-$variant.apk"
Write-Output "APK gerado: $apk"
