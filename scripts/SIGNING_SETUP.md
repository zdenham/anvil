# macOS Code Signing Setup

This is a one-time setup required before running signed builds.

## Prerequisites

You need the following files in the `secrets/` directory:
- `certificate.p12` - Developer ID Application certificate with private key
- `signing.env` - Environment variables for signing/notarization

## Setup Steps

### 1. Import the signing certificate

```bash
security import secrets/certificate.p12 \
  -k ~/Library/Keychains/login.keychain-db \
  -P "YOUR_P12_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
```

Replace `YOUR_P12_PASSWORD` with the certificate password (check `secrets/apple-credentials.txt`).

### 2. Verify the certificate is installed

```bash
security find-identity -v -p codesigning
```

Expected output:
```
1) 064F8C0FB28A5B2A8A5AC891BCCF931DFD3965FB "Developer ID Application: Altera.al Inc. (J6UGKXJCTQ)"
   1 valid identities found
```

### 3. Verify signing.env exists

```bash
cat secrets/signing.env
```

Should contain:
```
export APPLE_ID="..."
export APPLE_PASSWORD="..."  # App-specific password
export APPLE_TEAM_ID="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: Altera.al Inc. (J6UGKXJCTQ)"
```

## Troubleshooting

### "no identity found" error during build

The certificate isn't in your Keychain. Run step 1 above.

### "User interaction is not allowed" error

The Keychain is locked. Unlock it:
```bash
security unlock-keychain ~/Library/Keychains/login.keychain-db
```

### Certificate expired

Check expiration:
```bash
security find-certificate -c "Developer ID Application" -p | openssl x509 -noout -dates
```

If expired, generate a new certificate from https://developer.apple.com/account/resources/certificates/list

## Notes

- The certificate persists in Keychain across reboots - this setup only needs to be done once per machine
- The `secrets/` directory is gitignored and should never be committed
- For CI/CD, the certificate would need to be imported as part of the pipeline setup
