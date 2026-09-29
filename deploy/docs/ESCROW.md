# Source code escrow ({{VERSION}})

Persian version: `ESCROW.fa.md`.

`{{ESCROW_FILE}}` contains the complete source code of Sazkara Maintenance
{{VERSION}} (commit `{{COMMIT}}`), encrypted with AES-256. Even the list of files inside
is encrypted.

- The company **holds** this archive from today, so the source code already exists in
  its possession and cannot be withheld or altered later.
- The **password** is released by the developer on the terms set in the agreement
  (on final payment).
- It opens with 7-Zip (Windows) or `7z x {{ESCROW_FILE}}` (Linux, package `p7zip-full`).

**Fingerprint.** To prove later that this is the same archive that was handed over,
compare its SHA-256 checksum with the value below. Record it in the agreement or the
handover minutes.

```
SHA-256  {{ESCROW_SHA256}}
Date     {{DATE}}
```

Check it with `sha256sum {{ESCROW_FILE}}` (Linux) or
`Get-FileHash {{ESCROW_FILE}}` (Windows PowerShell).
