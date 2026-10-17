# Backend

Run from the bookmark-app directory with Python 3.11 or 3.12:

```sh
python -m pip install -r requirements.txt
DATA_DIR=./data python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
python -m pytest backend/tests -q
```

`backend.main:create_app(data_dir, start_worker=False)` provides isolated application instances for tests. All tests use temporary databases, mocked model responses, and mocked fetch transports; they never load user credentials or call a live model.

The SQLite database is `DATA_DIR/bookmarks.sqlite3`; DATA_DIR defaults to `./data`. Its directory is private (0700) and database is 0600. SQLite WAL sidecars live there too. The server serves `web/dist` relative to the project root, with SPA fallback. `ALLOWED_ORIGINS` optionally supplies an explicit comma-separated origin allowlist for development; normal same-origin browser access needs no setting.

`bookmark_query.py` performs scoped list reads in one SQLite read snapshot, with directory/order indexes and no per-record connection loop. Optional server pagination returns the full matching count and, when requested, all matching IDs for bulk selection. Summary rows exclude long text; authenticated detail reads supply it on demand. The default complete unpaged API remains compatible. Search retains the existing Unicode substring behavior through a deterministic SQLite function, rather than changing Chinese matching to a different tokenizer. Semantic page turns may reuse a bounded, short-lived query vector, while reading current bookmark/index data on every request; model requests run outside database transactions. See `API-CONTRACT.md` for parameters and response shapes.

Passwords use salted scrypt, sessions and extension tokens persist only as SHA-256 digests, and session cookies are HttpOnly/SameSite=Strict while supporting LAN HTTP. Extension bearer authorization is limited to POST `/api/bookmarks` and GET `/api/connection`. Bearer save responses contain only `{bookmark:{id,url},duplicate}` to prevent reading private metadata through a duplicate save. Authenticated browser saves return the full bookmark.

The database also holds provider API keys and durable task configuration. The application JSON download excludes API keys, account credentials, sessions, and tokens. A filesystem backup of DATA_DIR contains secrets; preserve private permissions and back up SQLite consistently rather than copying a live database file without its WAL.

Jobs retain per-bookmark tasks and three bounded automatic attempts. Startup requeues interrupted running tasks. Pausing prevents new tasks from being claimed; an already-running provider call may finish. Resuming continues queued tasks; retry resets failed tasks. Use one Uvicorn worker process so startup recovery does not compete with another process. Concurrency is configured within the app from 1 to 5.

Reindex jobs require all active bookmarks. They stage vectors and source revisions, validate dimensions and active bookmark revisions, and atomically publish only a complete unchanged successful rebuild. A failed rebuild retains the prior index. Text changes and new saves mark rebuilding needed. Semantic search embeds the query once using the active index configuration and falls back to keyword search with a warning on provider failure. Disabling send_excerpt excludes excerpt from both classification and embedding.

Manual folder/tag edits protect classification. An explicit forced job may override prior manual choices, but cannot overwrite an edit made during its network call. HTML preserve imports retain their original folder during later classification while supplementing tags and summary; force overrides that preservation. Imports never automatically queue jobs. JSON restore validates all data/settings before writing and applies changes in one transaction, merging by normalized URL and folder hierarchy. HTML export/import includes hierarchy, tags, and notes; JSON additionally contains trash, manual protection, summary, and nonsecret settings.

AI organizer changes are stored and validated before application. In addition to name/parent changes, an optional `merge_into` folder ID moves source bookmarks and children to the target on confirmation, retaining bookmark manual flags. Invalid targets and cycles are rejected. A preview can be applied once.

Public page fetch validates every resolved address and redirect, rejects private/reserved/multicast addresses, pins connections to a checked IP while preserving Host/TLS SNI, disables environment proxies, bounds responses to 2 MB and extracted excerpts to 12,000 characters, and extracts plain text. Model bases are user-configured and may point to a local OpenAI-compatible service. Page content is passed as untrusted data. No model configuration is necessary for normal saving.
