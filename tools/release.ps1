param(
  [Parameter(Mandatory = $true)][string]$Tag,      # b1.0 / b1.1 / b1.1hotfix
  [string]$Notes = '',
  [switch]$NoUpload
)

# Solstice 发布脚本
#   b1.0        -> manifest 1.0.0
#   b1.1        -> manifest 1.1.0
#   b1.1hotfix  -> manifest 1.1.1
# 产物：build/solstice-b1.0.crx  +  GitHub release（tag 同名）

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Convert-Tag([string]$tag) {
  if ($tag -match '^[bB](\d+)\.(\d+)(?:-?hotfix|\.(\d+))?$') {
    $major = $Matches[1]
    $minor = $Matches[2]
    $patch = if ($Matches[3]) { $Matches[3] } elseif ($tag -match 'hotfix') { '1' } else { '0' }
    return "$major.$minor.$patch"
  }
  throw "tag 必须形如 B3.4 / B3.3.1 / b1.0"
}

$version = Convert-Tag $Tag
$build = Join-Path $root 'build'
$stage = Join-Path $build 'stage'
$crxOut = Join-Path $build "AlwaysWin-$Tag.crx"
$zipOut = Join-Path $build "AlwaysWin-$Tag.zip"
$keyFile = Join-Path $build 'alwayswin.pem'

New-Item -ItemType Directory -Force -Path $build | Out-Null
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

# ── 1. 写版本号 ────────────────────────────────────────────────────
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content -Raw $manifestPath
$manifest = [regex]::Replace($manifest, '"version":\s*"[^"]+"', '"version": "' + $version + '"')
$manifest = [regex]::Replace($manifest, '"version_name":\s*"[^"]+"', '"version_name": "' + $Tag + '"')
Set-Content -Path $manifestPath -Value $manifest -NoNewline -Encoding utf8
Write-Host "version -> $version (tag $Tag)"

# ── 2. 暂存（排除开发目录）─────────────────────────────────────────
$exclude = @('preview', 'build', '.git', 'tools', '.gitignore')
Get-ChildItem $root -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  Copy-Item $_.FullName -Destination $stage -Recurse -Force
}

if (Test-Path $zipOut) { Remove-Item $zipOut -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipOut -CompressionLevel Optimal

# ── 3. 打包 crx ────────────────────────────────────────────────────
$edge = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $edge) { throw '找不到 Edge/Chrome' }

$args = @("--pack-extension=$stage", '--no-message-box', '--headless=new', '--disable-gpu')
if (Test-Path $keyFile) { $args += "--pack-extension-key=$keyFile" }

if (Test-Path "$stage.crx") { Remove-Item "$stage.crx" -Force }
Start-Process -FilePath $edge -ArgumentList $args -Wait
Start-Sleep -Milliseconds 600

if (-not (Test-Path "$stage.crx")) { throw '打包失败：没有生成 crx' }
if (Test-Path $crxOut) { Remove-Item $crxOut -Force }
Move-Item "$stage.crx" $crxOut -Force

# 首次打包时把 key 留下来，保证扩展 ID 不变
if (-not (Test-Path $keyFile) -and (Test-Path "$stage.pem")) {
  Move-Item "$stage.pem" $keyFile -Force
}

$size = [math]::Round((Get-Item $crxOut).Length / 1MB, 2)
Write-Host "crx -> $crxOut ($size MB)"

if ($NoUpload) { exit 0 }

# ── 4. 建 GitHub release 并上传资产 ────────────────────────────────
$cred = ("protocol=https`nhost=github.com`n`n" | git credential fill) -split "`n"
$token = (($cred | Where-Object { $_ -like 'password=*' }) -replace '^password=', '')
if (-not $token) { throw '没有可用的 GitHub 凭据' }

$repo = (git remote get-url origin) -replace '^https://github.com/', '' -replace '\.git$', ''
$headers = @{ Authorization = "token $token"; 'User-Agent' = 'solstice-release'; Accept = 'application/vnd.github+json' }
$body = @{ tag_name = $Tag; name = $Tag; target_commitish = 'beta'; draft = $false; prerelease = $false; body = $Notes } | ConvertTo-Json

$existing = $null
try {
  $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$Tag" -Headers $headers -TimeoutSec 20
} catch { }

if ($existing) {
  Write-Host "release $Tag 已存在，改为上传资产"
  $release = $existing
} else {
  $release = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
  Write-Host "release 已创建：$($release.html_url)"
}

$uploadUrl = ($release.upload_url -replace '\{.*$', '') + "?name=solstice-$Tag.crx"
$bytes = [System.IO.File]::ReadAllBytes($crxOut)
$assetHeaders = $headers.Clone()
$assetHeaders['Content-Type'] = 'application/octet-stream'

$asset = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $assetHeaders -Body $bytes -TimeoutSec 120
Write-Host "资产已上传：$($asset.browser_download_url)"

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
