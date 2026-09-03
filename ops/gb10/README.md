# GB10 deployment

The deployment uses the existing GB10 Python 3.12 virtual environment at
`/home/wjc/yunpai0902-gb10/venv` and does not modify the frozen M0-M5 stacks.
The API listens on `127.0.0.1:9000`; `static_proxy.py` serves the built frontend
and proxies `/api/*` on `0.0.0.0:39092`.

Runtime databases are SQLite snapshots under `runtime/`:

- `yunpai-runs.sqlite`: run state, trace, Gate and agent intent/router records.
- `yunpai-business-catalog.sqlite`: business source files, document candidates and field observations.

Before replacing either database, stop writers, run `PRAGMA integrity_check`,
compare SHA-256 locally and remotely, and only then atomically rename the
staged file into the release directory. Raw files under the Mac external disk
are not copied by this deployment; the catalog retains their absolute path and
SHA-256 evidence so re-ingestion can detect drift when the source is mounted.
