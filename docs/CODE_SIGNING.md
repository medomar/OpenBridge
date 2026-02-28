# Code Signing — OpenBridge

> **Status:** Code signing is out of scope for the initial release (v0.0.x). This document explains what users will encounter and how to work around it, plus instructions for maintainers who want to add signing in the future.

---

## macOS — Gatekeeper Warning

### What users see

When a user downloads and opens an unsigned `.dmg` or runs the bare binary, macOS Gatekeeper shows:

```
"OpenBridge" can't be opened because it is from an unidentified developer.
```

The binary is quarantined by default when downloaded from the internet. This happens to **all unsigned macOS executables** regardless of their origin.

### Workaround (no Apple Developer account needed)

**Option 1 — Right-click to open (recommended):**

1. In Finder, right-click (or Control-click) on `OpenBridge.app` or the binary.
2. Choose **Open** from the context menu.
3. A dialog appears: _"macOS cannot verify the developer of 'OpenBridge'. Are you sure you want to open it?"_
4. Click **Open**.
5. The app opens. The quarantine flag is cleared — future launches work normally.

**Option 2 — Remove the quarantine attribute manually:**

```bash
xattr -d com.apple.quarantine /path/to/OpenBridge.app
# or for the bare binary:
xattr -d com.apple.quarantine /path/to/openbridge-macos-arm64
```

**Option 3 — System Settings override (for repeated installs):**

1. Open **System Settings → Privacy & Security**.
2. Scroll down to the Security section.
3. After a failed open attempt, a message appears: _"OpenBridge was blocked from use because it is not from an identified developer."_
4. Click **Open Anyway**.

### Proper fix — Apple Developer code signing

To eliminate the Gatekeeper warning for all users, the release binary must be code-signed and notarized with an Apple Developer account.

**Requirements:**

- Apple Developer Program membership — $99/year (https://developer.apple.com/programs/)
- A **Developer ID Application** certificate issued to your Apple Developer account
- Xcode Command Line Tools installed (`xcode-select --install`)

**Step 1 — Sign the app bundle:**

```bash
# Sign the binary inside the app bundle
codesign \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  --options runtime \
  --timestamp \
  --deep \
  OpenBridge.app

# Verify the signature
codesign --verify --verbose OpenBridge.app
spctl --assess --verbose OpenBridge.app
```

**Step 2 — Notarize with Apple:**

Notarization is an additional scan by Apple servers. Without it, Gatekeeper still warns even for signed apps on macOS 10.15+.

```bash
# Create a zip for submission (notarytool doesn't accept .app directly)
ditto -c -k --keepParent OpenBridge.app OpenBridge.zip

# Submit for notarization (replace placeholders with your credentials)
xcrun notarytool submit OpenBridge.zip \
  --apple-id "you@example.com" \
  --team-id "YOURTEAMID" \
  --password "app-specific-password" \
  --wait

# Staple the notarization ticket to the app bundle
xcrun stapler staple OpenBridge.app

# Re-create the .dmg from the stapled app
./scripts/create-dmg.sh
```

**Step 3 — Verify notarization:**

```bash
xcrun stapler validate OpenBridge.app
spctl --assess --type exec --verbose OpenBridge.app
```

**For CI (GitHub Actions):**

Store the Developer ID certificate and Apple credentials as GitHub Actions secrets, then use the `apple-actions/import-codesign-certs` and `apple-actions/notarize-app` actions in the release workflow.

---

## Windows — SmartScreen Warning

### What users see

When a user downloads and runs the unsigned `.exe` installer or the bare `openbridge-win-x64.exe` binary, Windows Defender SmartScreen shows:

```
Windows protected your PC

Microsoft Defender SmartScreen prevented an unrecognized app from starting.
Running this app might put your PC at risk.
```

This happens to **all unsigned executables** downloaded from the internet. As OpenBridge accumulates download volume and reputation, the warning may disappear automatically — but this takes weeks to months.

### Workaround

1. In the SmartScreen dialog, click **More info**.
2. A second dialog appears showing the app name and publisher ("Unknown publisher").
3. Click **Run anyway**.
4. The app launches normally. The warning appears on each new download (not on subsequent runs).

**Alternative — right-click → Properties:**

1. Right-click the downloaded `.exe` in Windows Explorer.
2. Choose **Properties**.
3. At the bottom of the General tab, check **Unblock** if present.
4. Click **OK**, then run the file normally.

### Proper fix — Authenticode code signing

Windows code signing uses **Authenticode** certificates issued by a Certificate Authority (CA).

**Requirements:**

- A **Code Signing Certificate** from a trusted CA:
  - DigiCert, Sectigo, GlobalSign, or similar — prices vary ($200–$500/year for OV, $400–$900/year for EV)
  - **EV (Extended Validation)** certificates eliminate the SmartScreen warning immediately; OV certificates may still show it until reputation builds
- `signtool.exe` (included in Windows SDK, installed with Visual Studio)

**Signing the binary:**

```powershell
# Using signtool (Windows SDK)
signtool sign `
  /tr http://timestamp.digicert.com `
  /td sha256 `
  /fd sha256 `
  /a `
  openbridge-win-x64.exe

# Verify the signature
signtool verify /pa openbridge-win-x64.exe
```

**Using osslsigncode (cross-platform, e.g., from Linux CI):**

```bash
osslsigncode sign \
  -certs certificate.pem \
  -key private-key.pem \
  -ts http://timestamp.digicert.com \
  -in openbridge-win-x64.exe \
  -out openbridge-win-x64-signed.exe
```

**NSIS installer signing:**

Sign the generated `.exe` installer using the same `signtool` command after NSIS creates it. The installer and the bundled binary should both be signed.

**For CI (GitHub Actions):**

Store the Base64-encoded PFX certificate and password as GitHub Actions secrets. Use `azure/trusted-signing-action` or a custom PowerShell step to sign on a `windows-latest` runner.

---

## Linux — No Signing Requirement

Linux does not have a system-level code signing requirement equivalent to macOS Gatekeeper or Windows SmartScreen. Users download and run the binary or AppImage directly. Package managers (`.deb`, `.rpm`) have their own signature mechanisms via GPG:

```bash
# Sign a .deb package
dpkg-sig --sign builder openbridge_0.0.1_amd64.deb

# Verify
dpkg-sig --verify openbridge_0.0.1_amd64.deb
```

AppImages can be signed with a GPG key and the signature embedded:

```bash
gpg --detach-sign OpenBridge-x86_64.AppImage
```

This is optional but recommended for distribution via software centers.

---

## Summary

| Platform | Warning Type                          | User Workaround        | Proper Fix                                     | Cost         |
| -------- | ------------------------------------- | ---------------------- | ---------------------------------------------- | ------------ |
| macOS    | Gatekeeper ("unidentified developer") | Right-click → Open     | Apple Developer cert + `codesign` + notarytool | $99/yr       |
| Windows  | SmartScreen ("unrecognized app")      | More info → Run anyway | Authenticode cert (OV or EV) + signtool        | $200–$900/yr |
| Linux    | None                                  | N/A                    | GPG signing (optional)                         | Free         |

Code signing is planned for a future release once the project reaches a stable distribution cadence. Track progress in [docs/ROADMAP.md](ROADMAP.md).
