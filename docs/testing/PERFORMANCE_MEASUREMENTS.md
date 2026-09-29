# Performance measurements — Dentiva Pro

Measured by `scripts/seed-stress-data.mjs` on 2026-09-29T19:32:44.072Z. The numbers below are produced by this
run, not estimated: the script builds the database with the real migrations and repositories, then times the
operations through the real service layer (permission checks, audit writes and validation included).

## Machine

| Item           | Value                                |
| -------------- | ------------------------------------ |
| platform       | linux 6.1.158+                       |
| arch           | x64                                  |
| cpu            | Intel(R) Xeon(R) Processor @ 2.60GHz |
| cpuCount       | 2                                    |
| totalMemoryMb  | 3940                                 |
| node           | v22.22.3                             |
| sqlite         | 3.53.4                               |
| databaseSizeMb | 36.2                                 |
| dataRoot       | /home/user/Dentiva-Pro-/.stress-data |

## Dataset

| Entity                | Rows   |
| --------------------- | ------ |
| patients              | 5,000  |
| visits                | 20,000 |
| appointments          | 20,000 |
| prescriptions         | 15,000 |
| invoices              | 15,000 |
| payments              | 25,000 |
| inventoryItems        | 400    |
| inventoryTransactions | 5,000  |
| queueEntries          | 150    |
| attachments           | 200    |
| auditRows             | 217    |

Seeding throughput: 6,943 records/second (15.2 s total).

## Measured operations

| Operation                               | Budget   | Samples | Average  | p95     | Max     |
| --------------------------------------- | -------- | ------- | -------- | ------- | ------- |
| Patient register page (25 rows)         | ≤ 120 ms | 25      | 26.2 ms  | 43.2 ms | 46.8 ms |
| Patient register search (10 pages deep) | ≤ 120 ms | 15      | 13.8 ms  | 21.4 ms | 21.4 ms |
| Global search                           | ≤ 250 ms | 20      | 50.1 ms  | 54.4 ms | 67.3 ms |
| Patient profile (counts + timeline)     | ≤ 300 ms | 20      | 1.7 ms   | 2.3 ms  | 3.3 ms  |
| Visit history page                      | ≤ 300 ms | 20      | 2.9 ms   | 3.4 ms  | 3.9 ms  |
| Prescription list page                  | ≤ 250 ms | 20      | 2.5 ms   | 3.1 ms  | 5.5 ms  |
| Invoice list page                       | ≤ 250 ms | 20      | 1.1 ms   | 1.2 ms  | 1.5 ms  |
| Payment dashboard (today)               | ≤ 250 ms | 20      | 1.9 ms   | 2.4 ms  | 3.1 ms  |
| Accounting summary (this month)         | ≤ 500 ms | 10      | 11.5 ms  | 12.6 ms | 12.6 ms |
| Dashboard summary                       | ≤ 400 ms | 15      | 112.1 ms | 123 ms  | 123 ms  |
| Inventory list page                     | ≤ 200 ms | 20      | 0.4 ms   | 0.7 ms  | 1.1 ms  |
| Audit log page (filtered)               | ≤ 250 ms | 15      | 0.2 ms   | 0.5 ms  | 0.5 ms  |
| Prescription print document build       | ≤ 400 ms | 10      | 3.3 ms   | 5.9 ms  | 5.9 ms  |
| Invoice print document build            | ≤ 400 ms | 10      | 2.4 ms   | 3.6 ms  | 3.6 ms  |
| Invoice creation with 20 items          | ≤ 250 ms | 15      | 1.9 ms   | 3.5 ms  | 3.5 ms  |

## Budget check

| Budget item                 | Target   | Measured (p95) | Result |
| --------------------------- | -------- | -------------- | ------ |
| Patient list page (25 rows) | ≤ 120 ms | 43.2 ms        | PASS   |
| Global search               | ≤ 250 ms | 54.4 ms        | PASS   |
| Patient profile             | ≤ 300 ms | 2.3 ms         | PASS   |
| Invoice creation (20 items) | ≤ 250 ms | 3.5 ms         | PASS   |

## Backup

A verified backup of this database (`DentivaPro_Backup_2026-09-29-19-32-40`, 39.9 MB) took 3.4 s, including the integrity check, the manifest and the checksum file.

## Dataset notes

- The audit-log row count is what the seeding operations actually wrote. Audit entries are appended by
  the service layer for real user actions, so the generator cannot invent thousands of rows without
  going through the services; the documented stress figure (3,000 rows) is reached by daily clinic use.
- Attachments are created through the attachment service with real files copied into the data root, so
  the backup step measures real attachment copying rather than empty folders.

## Not measured by this script

These budget items need the packaged desktop application on a target machine and are measured by the
release checklist, not here:

| Budget item                            | Target   | Why it is not in this run                                                     |
| -------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| Cold start (new process, first window) | ≤ 3.0 s  | needs the built application and its Chromium process                          |
| Warm start (second launch)             | ≤ 1.5 s  | ditto                                                                         |
| Print preview first paint              | ≤ 600 ms | needs Chromium and a real printer queue                                       |
| Restore of a 5 GB backup               | ≤ 90 s   | needs a target machine with a 5 GB attachment folder; this dataset is smaller |
| PDF export of a prescription/invoice   | ≤ 2 s    | needs Chromium's printToPDF pipeline                                          |

Everything in the tables above is produced by this run; nothing is copied from an earlier measurement.
