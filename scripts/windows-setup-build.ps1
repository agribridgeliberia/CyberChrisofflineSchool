<#
Windows setup + build helper for School Management System

Usage (run as Administrator):
1) Open an elevated PowerShell (Run as Administrator)
2) cd to the project root, e.g.:
   cd "C:\Users\CyberChris\Desktop\projects\Offline School"
3) Execute this script:
   .\scripts\windows-setup-build.ps1

What this script does (if you choose to run the automatic steps):
- Optionally installs Visual Studio 2022 Build Tools via winget (if winget exists)
- Re-installs node modules (`npm install`)
- Runs `npx electron-rebuild -f -w sqlite3` to rebuild native modules for Electron
- Runs `npm run dist` to build Windows artifacts (NSIS installer and portable .exe)

IMPORTANT:
- The automatic installer step requires admin privileges and internet access.
- If you prefer manual installation, install "Build Tools for Visual Studio" and select "Desktop development with C++" workload:
  https://visualstudio.microsoft.com/downloads/

Notes:
- If you don't have `winget`, visit the link above and install Build Tools manually.
- Building can take several minutes and needs ~1-2GB free disk space.

#>

param(
    [switch]$InstallBuildTools
)

function Write-Note($msg){ Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg){ Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg){ Write-Host "[ERROR] $msg" -ForegroundColor Red }

Write-Note "Windows build helper starting. Make sure PowerShell is running as Administrator."

# Optionally install Visual Studio Build Tools via winget
if ($InstallBuildTools) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Note "Attempting to install Visual Studio Build Tools via winget..."
        Write-Note "This may take a while and requires user interaction or admin rights."
        winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "winget install returned non-zero exit code. Please install Build Tools manually: https://visualstudio.microsoft.com/downloads/"
        }
    } else {
        Write-Warn "winget not found. Please install Build Tools manually: https://visualstudio.microsoft.com/downloads/"
    }
} else {
    Write-Note "Skipping automatic Build Tools install. Ensure 'Desktop development with C++' workload is installed."
}

# Reinstall node modules
Write-Note "Running npm install (may rebuild modules)..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed. Fix errors and re-run the script."; exit 1 }

# electron-rebuild (recommended)
if (Get-Command npx -ErrorAction SilentlyContinue) {
    Write-Note "Running electron-rebuild for sqlite3..."
    npx electron-rebuild -f -w sqlite3
    if ($LASTEXITCODE -ne 0) { Write-Warn "electron-rebuild failed. You may need Visual Studio Build Tools installed and configured." }
} else {
    Write-Warn "npx not found. Skipping electron-rebuild. You can run: npx electron-rebuild -f -w sqlite3"
}

# Run electron-builder
Write-Note "Starting packaging (electron-builder)... this can take several minutes."
npm run dist
if ($LASTEXITCODE -ne 0) { Write-Err "Build failed. Review the output above for errors (native rebuild issues, missing build tools, etc.)."; exit 1 }

Write-Note "Build finished. Check the 'dist' directory for installer and portable artifacts." 

# End of script
