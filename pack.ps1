# sdd-loop packaging script
# Usage: powershell -ExecutionPolicy Bypass -File pack.ps1
# Output: dist/sdd-loop-<version>-<stamp>.zip

$ErrorActionPreference = "Stop"
$PluginDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---- version ----
$pkg = Get-Content -LiteralPath (Join-Path $PluginDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
$stamp = Get-Date -Format "yyyyMMdd"

# ---- required file check ----
$required = @("package.json", "index.js", "agent\sdd-loop.md", "sdd-loop.json")
foreach ($f in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $PluginDir $f))) {
        Write-Error "Missing required file: $f"
        exit 1
    }
}
$hasNodeModules = Test-Path -LiteralPath (Join-Path $PluginDir "node_modules")
if (-not $hasNodeModules) {
    Write-Warning "WARNING: node_modules not found - receiver must run 'bun install' themselves. Run 'bun install' before packaging."
}

# ---- output dir ----
$distDir = Join-Path $PluginDir "dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
$zipName = "sdd-loop-$version-$stamp.zip"
$zipPath = Join-Path $distDir $zipName

# ---- clean old zips ----
Get-ChildItem -Path $distDir -Filter "sdd-loop-*.zip" -ErrorAction SilentlyContinue | Remove-Item -Force

# ---- staging dir ----
$stage = Join-Path $env:TEMP ("sdd-loop-pack-" + $PID)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# ---- copy plugin files (exclude dist / .git / .slim / node_modules / .workflow / ai-record / .aspirecode) ----
$excludeDirs = @("dist", ".git", ".slim", "node_modules", ".workflow", "ai-record", ".aspirecode")
Get-ChildItem -LiteralPath $PluginDir -Force | ForEach-Object {
    $skip = $false
    foreach ($e in $excludeDirs) {
        if ($_.Name -eq $e) { $skip = $true; break }
    }
    if (-not $skip) {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $_.Name) -Recurse -Force
    }
}

# ---- node_modules: exclude .bin / .cache ----
if ($hasNodeModules) {
    $nmSrc = Join-Path $PluginDir "node_modules"
    $nmDst = Join-Path $stage "node_modules"
    New-Item -ItemType Directory -Path $nmDst | Out-Null
    Get-ChildItem -LiteralPath $nmSrc -Force | ForEach-Object {
        if ($_.Name -in @(".bin", ".cache")) { return }
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $nmDst $_.Name) -Recurse -Force
    }
}

# ---- generate INSTALL.md (single-quoted here-string: no parsing) ----
$installDoc = @'
# sdd-loop Installation Guide

## 1. Extract

Put the sdd-loop folder anywhere, e.g. D:\Tools\sdd-loop

## 2. Configure opencode.json

In your OpenCode config directory's opencode.json:

1) Add the extracted directory to the plugin array:

```jsonc
{
  "plugin": [
    // keep existing plugins...
    "D:\\Tools\\sdd-loop"
  ]
}
```

2) Check sdd-loop.json inside the plugin folder. Verify the preset and model names match YOUR provider config:

- Top-level "preset" field: choose "deepseek" or "volcengine"
- Each agent's "model" field: must be a provider + model name you have configured

Example (volcengine):

```jsonc
{
  "preset": "volcengine",
  "presets": {
    "volcengine": {
      "sdd-loop": { "model": "volcengine-plan/deepseek-v4-pro", "variant": "high" }
    }
  }
}
```

## 3. Restart OpenCode

After restart, switch to sdd-loop with /agent. Sub-agents (spec-writer, researcher, scout, implementer, reviewer, ui-designer) are callable only by sdd-loop and will NOT appear in the agent switcher.

## 4. If the plugin fails to load

- Make sure node_modules exists in the folder (or run 'bun install' there)
- Make sure the plugin path in opencode.json is correct (absolute path or file:// prefix)
- Check OpenCode startup logs for plugin load errors
'@

Set-Content -LiteralPath (Join-Path $stage "INSTALL.md") -Value $installDoc -Encoding UTF8

# ---- zip ----
Write-Output "Packaging: $zipName ..."
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal
$sizeMB = "{0:N2}" -f ((Get-Item -LiteralPath $zipPath).Length / 1MB)

# ---- cleanup ----
Remove-Item -LiteralPath $stage -Recurse -Force

Write-Output ""
Write-Output "Done:"
Write-Output "  file: $zipPath"
Write-Output "  size: $sizeMB MB"
Write-Output ""
Write-Output "Share the zip. Receiver: extract, follow INSTALL.md."
