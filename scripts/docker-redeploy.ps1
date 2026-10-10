# One-click: rebuild the GopherAgent image and start a fresh container (Windows).
# The old container keeps running if the build fails.
#
# Usage:
#   .\scripts\docker-redeploy.ps1
#   .\scripts\docker-redeploy.ps1 -HostPort 80
#   .\scripts\docker-redeploy.ps1 -Target backend -HostPort 9899 -ContainerPort 9899
#   .\scripts\docker-redeploy.ps1 -ConfigFile C:\gopher\config.json
param(
  [string]$Image = "gopher-agent",
  [string]$Container = "gopher-agent",
  [int]$HostPort = 8080,
  [int]$ContainerPort = 80,
  [string]$DataVolume = "gopher-data",
  [string]$Tz = "Asia/Shanghai",
  [string]$ConfigFile = "/etc/gopher/config.json",
  [string]$Target = ""
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker not found in PATH"
}

Write-Host "==> 1/3  Building image '$Image'$(if ($Target) { " (target: $Target)" })" -ForegroundColor Green
$build = @("build", "-t", $Image)
if ($Target) { $build += @("--target", $Target) }
$build += "."
docker @build
if ($LASTEXITCODE -ne 0) { throw "docker build failed (old container left untouched)" }

Write-Host "==> 2/3  Recreating container '$Container'" -ForegroundColor Green
docker rm -f $Container 2>$null | Out-Null

Write-Host "==> 3/3  Starting container ($HostPort -> $ContainerPort, volume: $DataVolume)" -ForegroundColor Green
$run = @(
  "run", "-d",
  "--name", $Container,
  "-p", "${HostPort}:${ContainerPort}",
  "-v", "${DataVolume}:/data",
  "-e", "TZ=$Tz",
  "--restart", "unless-stopped"
)
# Mount an operator-supplied config.json read-only at the data root (recommended
# home for Redis credentials). Skipped with a warning when the file is absent so
# that docker does not create a *directory* in its place. On Windows pass a
# Windows path, e.g. -ConfigFile C:\gopher\config.json
if ($ConfigFile) {
  if (Test-Path -LiteralPath $ConfigFile) {
    $run += @("-v", "${ConfigFile}:/data/config.json:ro")
  } else {
    Write-Warning "ConfigFile '$ConfigFile' not found; mount skipped (container will use env vars / DB / built-in defaults)."
  }
}
$run += $Image
docker @run
if ($LASTEXITCODE -ne 0) { throw "docker run failed" }

Write-Host ""
docker ps --filter "name=^/$Container$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
Write-Host ""
Write-Host "Done.  http://<server-ip>:$HostPort" -ForegroundColor Green
Write-Host "Logs:   docker logs -f $Container"
