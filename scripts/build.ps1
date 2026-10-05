# Build GopherAgent into standalone binaries (pure Go, CGO disabled).
#
# Usage (run from anywhere):
#   .\scripts\build.ps1                       # native build -> .\gopheragent.exe
#   .\scripts\build.ps1 -All                  # cross-compile matrix -> .\dist\
#   .\scripts\build.ps1 -Targets linux/amd64,linux/arm64
#   .\scripts\build.ps1 -Version 1.2.3
#
# The version is injected into internal/controller/api.VersionString and is
# returned by GET /api/version.
param(
    [switch]$All,
    [string[]]$Targets,
    [string]$Version = "0.2.0"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:CGO_ENABLED = "0"
$ldflags = "-s -w -X 'GopherAgent/internal/controller/api.VersionString=$Version'"

function Build-Native {
    Write-Host "Building native -> gopheragent.exe"
    go build -trimpath -ldflags $ldflags -o "gopheragent.exe" .
}

function Build-Target([string]$os, [string]$arch) {
    $ext = if ($os -eq "windows") { ".exe" } else { "" }
    $out = "dist/gopheragent-$os-$arch$ext"
    Write-Host "Building $os/$arch -> $out"
    $env:GOOS = $os
    $env:GOARCH = $arch
    go build -trimpath -ldflags $ldflags -o $out .
}

New-Item -ItemType Directory -Force -Path "dist" | Out-Null

if ($All) {
    Build-Target "linux"   "amd64"
    Build-Target "linux"   "arm64"
    Build-Target "windows" "amd64"
    Build-Target "darwin"  "arm64"
} elseif ($Targets) {
    foreach ($t in $Targets) {
        $parts = $t -split "/"
        if ($parts.Count -ne 2) { throw "invalid target '$t' (expected os/arch)" }
        Build-Target $parts[0] $parts[1]
    }
} else {
    Build-Native
}

Remove-Item Env:CGO_ENABLED, Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
Write-Host "Done."
