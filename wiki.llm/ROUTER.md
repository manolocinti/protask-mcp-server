# ROUTER — memoria di progetto di protask-mcp-server

L'unica cosa che entra in contesto a SessionStart. Le regole complete stanno in `wiki.llm/SCHEMA.md`.

**Protocollo, da eseguire — non da riassumere:**

1. **Dichiara il dominio** su cui stai lavorando, prima di leggere codice. Se non è chiaro, **chiedi**.
   Un `grep` sul repo prima di aver aperto una mappa è ciò che questa memoria esiste per evitare.
2. Apri `wiki.llm/domini/<dominio>/MAPPA.md`, poi **solo** le pagine che la mappa indica.
3. Prima di **modificare** codice: leggi le mappe di `multitenancy` e `auth-e-permessi`. Gli altri
   trasversali si leggono **solo se la condizione** scritta accanto a loro nella tua mappa si applica.
4. Appendi a `wiki.llm/log.md`: `AAAA-MM-GG query — <dominio> — <cosa cercavi> → <pagine aperte>`.
5. Se la wiki **non** ha la risposta, dillo, vai al codice, e **scrivi il buco** nel log:
   `AAAA-MM-GG buco — <dominio> — <cosa non c'era>`. Non metterla insieme da pagine poco pertinenti,
   e una risposta ottenuta così non si scrive qui.

> ⚠️ **Questa wiki è ancora vuota.** Non ci sono domini. Prima di scriverne uno leggi `SCHEMA.md`:
> i confini fra domini sono la decisione che costa di più sbagliare, e si decidono guardando il
> codice (tabelle, route, cartelle), non per analogia con altri progetti.

## Domini — che cosa fa il prodotto

<!-- AUTO:domini -->
| dominio | quando aprirlo | pag | ver |
|---|---|--:|--:|
<!-- /AUTO:domini -->

## Trasversali — regole che valgono dentro ogni dominio

<!-- AUTO:trasversali -->
| trasversale | quando aprirlo | pag | ver |
|---|---|--:|--:|
<!-- /AUTO:trasversali -->

<!-- AUTO:stato -->
0 pagine · 0 mappe · 0 in archivio · 0 campi `da-verificare` · 0 verifiche scadute · divergenza main: non ancora su origin · develop: assente · log: 0 query, 0 ingest, **2 buchi** · lint 2026-11-20 (0 errori, 1 avvisi)
<!-- /AUTO:stato -->
