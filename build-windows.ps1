$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "Checking Node.js..."
node --version
npm --version

Write-Host "Checking Go..."
go version

Write-Host "Checking Wails..."
wails version

Write-Host "Installing npm dependencies..."
if (Test-Path "package-lock.json") {
  npm ci
} else {
  npm install
}

Write-Host "Tidying go modules..."
go mod tidy

Write-Host "Building Wails app (windows/amd64)..."
wails build -platform windows/amd64 -clean

Write-Host ""
Write-Host "Build complete."
Write-Host "Binary: build\bin\ACFun Live Helper.exe"
