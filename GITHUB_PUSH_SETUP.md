# Pushing this repo to GitHub (Windows + SSH)

This project uses an **SSH** remote:

```text
git@github.com:Wastopian/EElibrary.git
```

## Why `git push` can fail while `ssh -T` works

**Git for Windows** often runs its own `ssh.exe` (under `Git\usr\bin\`), not **Windows OpenSSH** (`C:\Windows\System32\OpenSSH\ssh.exe`). The two can read different config or expand `~` differently, which leads to **`Permission denied (publickey)`** even when `ssh -T git@github.com` succeeds in PowerShell.

**Fix (already set for this clone):** use Windows OpenSSH for all Git SSH commands in this repository:

```powershell
git config core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"
```

To use that for **every** repo on this machine:

```powershell
git config --global core.sshCommand "C:/Windows/System32/OpenSSH/ssh.exe"
```

## SSH key and config

1. Keep your **private** key only under `%USERPROFILE%\.ssh\` (never commit keys into the repo).
2. Register the matching **public** key (`.pub`) on GitHub: **Settings → SSH and GPG keys**.
3. If your private key is **not** named `id_ed25519` / `id_rsa`, tell SSH which file to use.

Create or edit **`%USERPROFILE%\.ssh\config`**:

```text
Host github.com
  HostName github.com
  User git
  IdentityFile C:/Users/<YOUR_WINDOWS_USERNAME>/.ssh/<YOUR_PRIVATE_KEY_FILENAME>
  IdentitiesOnly yes
```

Replace `<YOUR_WINDOWS_USERNAME>` and the key filename. Use forward slashes in `IdentityFile` (OpenSSH on Windows handles them well). If you use `~/.ssh/...`, some tools expand it incorrectly; an **absolute path** is the most reliable.

## Quick checks

```powershell
ssh -T git@github.com
```

Expected: `Hi <username>! You've successfully authenticated...`

```powershell
git push origin main
```

## Remote URL (HTTPS vs SSH)

Current expectation for this project is **SSH** (`git@github.com:...`). If you switch to HTTPS, pushes need a **personal access token** with appropriate scopes (GitHub may require **`workflow`** scope when `.github/workflows/` changes).

## Security

- Never paste or commit **private** keys.
- Public keys (`.pub`) are safe to share when adding them on GitHub.
