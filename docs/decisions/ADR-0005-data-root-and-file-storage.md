# ADR-0005 — Managed data root, relative paths, patient-code attachment folders

* **Status:** Accepted
* **Date:** 2026-09-29

## Context

The application must never scatter files, must never write into Program Files, must survive being moved
between machines/drives, must validate every path, and must let a clinic place data on a chosen drive
(REQ §47, §87).

## Decision

* A single **data root** is established during setup:
  `%APPDATA%\Dentiva Pro\data` by default, or a clinic-chosen folder. The choice is persisted in
  `%APPDATA%\Dentiva Pro\config\app-config.json`, and a `data-root.txt` file placed next to the installed
  executable (portable deployment) takes precedence.
* Standard sub-folders: `Database`, `Attachments/Patients/<PatientCode>`, `Backups`, `Exports`, `Logs`,
  `Temp`, `Config` (see `docs/architecture/ARCHITECTURE.md` §5).
* **Every path stored in the database is relative** to the data root (`attachments.stored_path`,
  `dentists.signature_path`, `clinic_profile.logo_path`, `staff.photo_path`). Absolute paths are never
  persisted.
* Attachment file names are `<uuid>-<sanitised-basename>`; the original name is kept in the database
  only. Sanitisation strips path separators, control characters, reserved Windows names (`CON`, `NUL`,
  `PRN`, `AUX`, `COM1…`, `LPT1…`), trailing dots/spaces and non-printable Unicode.
* Every resolution passes `assertInsideRoot()`: `path.resolve` + prefix check with trailing separator,
  rejecting `..`, symlink escapes, UNC and device paths. Violations are rejected and audited.
* Deletion of attachments removes the file only after the database row is marked deleted inside the same
  transaction; the delete is audited and the file is moved to `Temp/trash/<date>/` first (soft, recoverable).

## Consequences

* The whole installation is portable: copy the data root to another machine and the database remains
  valid (a "relocate data root" tool updates config only, since all stored paths are relative).
* Backups are self-contained: database + referenced attachments + configuration.
