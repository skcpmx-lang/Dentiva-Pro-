# ADR-0001 — Application stack: Electron + TypeScript + React + SQLite

* **Status:** Accepted
* **Date:** 2026-09-29
* **Deciders:** Principal Architect, Desktop Lead, Release Engineer

## Context

Dentiva Pro must be a commercial, offline-first Windows desktop application for dental clinics in
Bangladesh. It must print professional prescriptions and invoices (A4/A5/thermal/Bluetooth/network
printers), save as PDF with embedded Bengali fonts, store unlimited patient history locally, ship as a
professional installer, and be maintainable for years by a small team. The clinic may have no internet
at all.

## Decision

Use **Electron (38.x) + TypeScript 5.9 + React 19 + Vite (electron-vite) + SQLite (better-sqlite3 13,
N-API prebuilt binaries)**, packaged with **electron-builder (NSIS)**.

## Evaluation

| Criterion | Electron + SQLite | Tauri + SQLite | .NET 8 + WPF + SQLite |
|---|---|---|---|
| Offline reliability | Full (no runtime download) | Requires WebView2 runtime on clean machines | Full |
| Windows compatibility | Excellent (Win10 1903+/Win11) | Good, depends on WebView2 | Excellent |
| Printing (A4/A5/thermal, device options, preview, PDF) | Chromium print pipeline: device enumeration, per-call page size/margins/scale, `printToPDF` with font embedding | WebView2 print API is less capable; PDF path indirect | Strong printing but PDF needs extra libs |
| Bengali / complex script shaping | Chromium HarfBuzz shaping + OFL fonts bundled | Same engine (WebView2) but fewer print controls | Requires careful font/typography work |
| High-DPI | Native, per-monitor aware | Native | Native |
| Attachments / local FS | Node `fs` in main process | Rust fs | .NET IO |
| Security model | contextIsolation + sandbox + allow-listed IPC | Capability-based, strong | Strong |
| Installer quality | electron-builder NSIS: per-user install, no admin, data-preserving uninstall | WiX/NSIS via tauri-bundler | MSI/WiX |
| Commercial licence compatibility | MIT/BSD everywhere (see dependency audit) | MIT/Apache | MIT, but commercial 3rd-party libs risk |
| Startup performance | ~1.5–3 s (acceptable, optimized) | ~0.4 s | ~1 s |
| Memory | ~200–350 MB | ~90 MB | ~120 MB |
| Team velocity / UI quality for 60+ screens | Very high | Medium | Medium |
| CI/CD on GitHub Actions | Windows runners supported, packaging well-trodden | Good | Good |

`better-sqlite3` v13 ships **N-API prebuilt binaries for win32-x64 inside the npm package**, so no
Visual C++ toolchain and no post-install binary download are required — this is decisive for
reproducible, offline-friendly CI builds and clean-machine installs.

## Consequences

* Positive: one language across all layers; strongest printing story; mature packaging; largest talent pool.
* Negative: largest installer (~110–135 MB) and higher memory than native alternatives — accepted, and
  mitigated by lazy loading, a minimal main-process bundle and no unused dependencies.
* The application never requires the network at runtime; the only network use is CI/CD.

## Compliance with product constraints

No paid API, cloud, printing service, AI service or authentication service is used. All dependencies
are locally installed, open-source and licence-audited (`docs/compliance/DEPENDENCY_AUDIT.md`).
