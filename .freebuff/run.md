# EasyTroski Dev Server

## How to reproduce artifacts
- `node_modules/` must exist — run `npm install` if missing.
- `.env` must exist with Firebase and Google auth keys. Copy from main checkout if absent.

## How to run the server
```bash
npx expo start --web
```
This serves the app on **http://localhost:19006** (Expo web default port).

### Windows detached (PowerShell)
```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','web' -RedirectStandardOutput '<log>' -RedirectStandardError '<log>.err' -WindowStyle Hidden -PassThru).Id"
```
- stdout and stderr go to DIFFERENT files.
- Kill with `Stop-Process -Id <pid>`.
