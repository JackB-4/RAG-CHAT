Param(
  [Parameter(Mandatory=$true)][string]$Version
)

$ErrorActionPreference = 'Stop'

if (-not $Version.StartsWith('v')) { $Version = 'v' + $Version }

Write-Host "Tagging and pushing $Version..."
& git add -A
& git commit -m "chore: release $Version" 2>$null
& git tag $Version
& git push
& git push origin $Version

Write-Host 'GitHub Action will build and attach the installer to the Release.'
