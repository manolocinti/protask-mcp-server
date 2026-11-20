# Log — wiki.llm di protask-mcp-server

Registro append-only. Una riga per operazione, con data assoluta `AAAA-MM-GG`.
Forme: `ingest` (imparato un fatto) · `query` (risposto da memoria) · `buco` (la wiki non
copriva) · `port` (portata fra rami) ·
`archivia` (pagina superata) · `lint` (manutenzione).

- 2026-11-20 init — scheletro v2 creato dall'hook SessionStart (`~/.claude/hooks/wiki-locale.py`) dal template in `~/.claude/wiki-llm-template/`. Nessun dominio ancora: vanno decisi leggendo il codice, non copiati da un altro progetto
- 2026-11-20 buco — allegati — wiki vuota: niente su endpoint allegati ProTask (POST /tasks/{id}/attachments, campo file, max 20 MB, niente allegati sui commenti), trasporti stdio/http e deploy (pm2 + cron su main) → letto il codice
- 2026-11-20 buco — deploy — non scritto da nessuna parte: protask-mcp.ilmarketing.net gira sul VPS Contabo 173.212.194.180 (quello di n8n) dietro nginx 1.24; client_max_body_size portato a 21m il 2026-11-20 per gli allegati (prima 1 MB di default → 413)
