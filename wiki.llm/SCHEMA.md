# SCHEMA — wiki.llm v2

Questa è la **memoria canonica del progetto**. Ciò che una sessione impara di riutilizzabile lo
scrive qui; ciò che deve sapere lo legge da qui, invece di ri-esplorare il codebase o di chiedere
all'utente cose già note.

Questo file è **uno solo per tutti i domini**. Non esiste, e non va creato, uno schema per dominio:
due schemi si biforcano sempre — è già successo fra questa wiki e le memorie di sessione.

---

## 1. Struttura

```
wiki.llm/
├── SCHEMA.md          ← questo file: le regole. Si legge quando si scrive, non a ogni sessione
├── ROUTER.md          ← l'unica cosa iniettata a SessionStart. Dice in quale dominio entrare
├── log.md             ← registro append-only di ingest / query / port / lint, con date assolute
├── lint.py            ← i controlli deterministici. Nessun LLM. Scrive le zone <!-- AUTO --> di ROUTER.md
├── lint-config.json   ← la taratura del progetto (rami, ambienti, stack, eccezioni). lint.py resta
│                        IDENTICO al template: le differenze del repo stanno solo qui
├── lint-test.py       ← autoverifica del linter: 73 casi, i falsi negativi e i falsi positivi già visti
├── PORTING.md         ← come applicare questo schema a un altro repo
├── domini/
│   └── <dominio>/
│       ├── MAPPA.md   ← il punto d'ingresso del dominio (formato fisso, §4)
│       └── pagine/
│           └── <slug>.md
├── trasversali/
│   └── <nome>/
│       ├── MAPPA.md
│       └── pagine/
└── _archivio/
    └── <slug>.md      ← ciò che è stato superato. Mai `rm`
```

**Gli slug sono unici in tutta la wiki**, non per cartella. È ciò che permette a `[[slug]]` di
risolvere senza percorso, da qualunque pagina. `lint.py` rifiuta un duplicato.

### Che cosa non va nella struttura

**`ambiente`, `tenant` e `stack` sono dimensioni ortogonali e stanno nel frontmatter.** Non creare
mai `lead-staging/`, `immobili-tenant-fiore/`, `agenda-app/`. Una cartella per ambiente è una
biforcazione: due copie della stessa verità che divergono al primo aggiornamento fatto solo da una
parte. Se serve trovare tutte le pagine che valgono solo su staging, si filtra il frontmatter —
`lint.py --json` espone i campi.

---

## 2. Protocollo di sessione

Istruzioni operative. Vanno eseguite, non riassunte.

1. **A SessionStart entra in contesto solo `ROUTER.md`.** Non l'indice delle pagine, non le mappe.
   Se ciò che è arrivato in contesto è più grande di `ROUTER.md`, qualcosa non va: dillo.

2. **Prima di leggere codice, dichiara il dominio su cui stai lavorando.** Una riga, esplicita:
   «Lavoro sul dominio `agenda`». Se non è chiaro quale sia, **chiedi** — non tirare a indovinare e
   non aprire tutto per sicurezza.
   **Non esplorare il codebase a freddo.** Un `grep` su tutto il repo prima di aver aperto la mappa
   del dominio è il comportamento che questa wiki esiste per evitare.

3. **Apri `domini/<dominio>/MAPPA.md`.** Poi apri **solo** le pagine che la mappa indica. La mappa
   dice anche che cosa *non* sta lì e dove sta invece: se il tuo compito ricade nei suoi «confini»,
   cambia dominio adesso, non dopo aver letto tre pagine sbagliate.

4. **Prima di modificare codice in qualsiasi dominio, leggi `multitenancy` e `auth-e-permessi`.**
   Sempre, senza eccezioni: sono i due punti in cui un errore diventa un dato di un'agenzia visto da
   un'altra, o un permesso scavalcato. Costano ~12 KB e valgono più di qualunque test.
   **Gli altri trasversali si leggono a condizione.** La sezione «Trasversali da leggere» della tua
   mappa li elenca **con la condizione accanto**: leggi quelli la cui condizione si applica al lavoro
   che stai facendo, e nessun altro.
   *Il motivo è misurato*: le mappe dei trasversali pesano ~6 KB l'una. Con la regola «leggile tutte»
   una sessione ne caricava cinque, cioè 30 KB, per usarne due — e una regola che costa più di quanto
   rende viene abbandonata alla terza volta. Se una condizione non è scrivibile, quel trasversale non
   c'entra con quel dominio: toglilo dall'elenco.

5. **Appendi una riga a `log.md`** con dominio e pagine aperte:
   `YYYY-MM-DD query — <dominio> — <cosa cercavi> → <pagine aperte>`.

6. **Se la wiki non ha la risposta, dillo — e scrivilo.** Non sintetizzare una risposta mettendo
   insieme pagine poco pertinenti: una risposta così è indistinguibile da una vera e non ha modo di
   essere smentita. Vai al codice, rispondi dal codice, e appendi a `log.md`:
   `AAAA-MM-GG buco — <dominio> — <che cosa non c'era>`.
   Quella riga è la misura più onesta che questa memoria produce: dice **dove è vuota davvero**, e
   `lint.py` la conta e la scrive nel router. Senza, «dillo» resta un buon proposito che nessuno può
   verificare — e i buchi si scoprono solo quando fanno danno.
   **Una risposta ottenuta così non viene mai scritta nella wiki**: si scrive ciò che si è
   verificato sul codice, non ciò che si è dedotto dalla wiki.

---

## 3. Frontmatter obbligatorio di pagina

```yaml
---
name: slug-della-pagina           # = nome del file senza .md, unico in tutta la wiki
description: una riga             # cosa si impara aprendola. È il gancio, non il titolo
dominio: agenda                   # cartella in cui vive. Esattamente una
tipo: architettura                # architettura | dato | decisione | procedura | trappola | integrazione
stato: stabile                    # stabile | in-evoluzione | superato
ambiente: [prod, staging]         # dove vale. Sottoinsieme di [prod, staging]
tenant: tutti                     # "tutti" oppure [slug-agenzia, ...]
stack: [web]                      # sottoinsieme di [web, app, worker]
fonti:                            # percorsi RELATIVI ALLA RADICE DEL REPO, verificati da lint.py
  - src/lib/scheduling/validate-slot.ts:40-96
  - src/db/schema/appointments.ts
aggiornato_il: 2026-08-06         # quando il testo è stato scritto o riscritto
verificato_il: 2026-08-06         # quando qualcuno ha ricontrollato che è ancora vero
supersede: vecchio-slug           # opzionale: questa pagina sostituisce quella
---
```

Note che non sono ovvie:

- **`aggiornato_il` e `verificato_il` sono due date diverse, di proposito.** La prima dice quando
  qualcuno ha scritto; la seconda quando qualcuno ha *guardato il codice* e confermato. Una pagina
  scritta bene sei mesi fa e mai riletta è pericolosa quanto una scritta male ieri. Se aggiorni
  solo la forma, non toccare `verificato_il`.
- **`fonti` è machine-readable.** Percorsi dalla radice del repo, con `:riga` o `:da-a` quando il
  punto esatto conta. `lint.py` verifica che ogni file esista. Un nome nudo (`tools.ts`) o un
  frammento (`help-bot/knowledge.md`) **non è una fonte**: nel repo ci sono file omonimi, e nessuna
  macchina può dire se la citazione regge. Nel corpo, i riferimenti si scrivono comunque come
  `` `percorso:riga` ``, ma è `fonti:` a fare fede.
- **`tenant`** serve a distinguere ciò che è vero per il prodotto da ciò che è vero per
  un'agenzia sola. Se una pagina descrive una configurazione di un singolo cliente, dichiaralo:
  altrimenti finirà applicata a tutti.
- **`stato: superato`** non è un'opinione: obbliga a `supersede:` e a spostare il file in
  `_archivio/`.
- Se un campo non lo puoi dedurre né dal contenuto né dal codice, scrivi **`da-verificare`**. È un
  valore ammesso, `lint.py` lo conta e lo elenca. Non inventare.

---

## 4. Formato di `MAPPA.md`

**Tetto: 110 righe.** La mappa è l'unica cosa che si legge per intero ogni volta che si entra nel
dominio: se cresce, smette di essere letta.

Una mappa **non riassume le pagine**. Contiene ciò che le pagine *non* contengono. Se è un elenco
di link, è sbagliata.

Il campo **`router:`** è la riga che questa mappa occuperà in `ROUTER.md`: dice *quando aprirla*,
non che cosa contiene. Massimo **90 caratteri** — è l'unico modo deterministico per tenere il router
sotto il suo tetto man mano che i domini crescono. `ROUTER.md` non si scrive a mano: la sua tabella
la genera `lint.py` da questi campi.

Sezioni obbligatorie, in quest'ordine:

```markdown
---
name: agenda
tipo: mappa
dominio: agenda
router: quando tocchi appuntamenti, turni, assenze, chiusure o durate delle visite
aggiornato_il: 2026-08-06
verificato_il: 2026-08-06
---

# agenda

## Cos'è
Tre righe. Che cosa fa questo dominio per l'utente finale. Non l'architettura.

## Superficie di codice
Tabelle · modelli · route · cartelle · job · eventi. Con i numeri.
È la risposta a "dove metto le mani", data prima di aprire il codice.

## Invarianti
Le cose che devono restare vere. Una riga ciascuna, al presente.
Se ne violi una, hai introdotto un difetto anche se i test passano.

## Decisioni chiuse ⛔ non ridiscutere
Scelte già fatte, con il motivo in mezza riga. Servono a non rifare la stessa
conversazione ogni mese. Se una va riaperta, la riapre l'utente, non la sessione.

## Trappole note
Ognuna con il **sintomo osservabile**: che cosa vedi quando ci sei dentro.
Una trappola senza sintomo non è utilizzabile.

## Differenze prod / staging
Che cosa non è uguale sui due ambienti. "Nessuna" è una risposta valida e va scritta.

## Comportamento multitenant
Come questo dominio isola le agenzie, e dove è più facile sbagliare.

## Trasversali da leggere
`multitenancy` e `auth-e-permessi` si leggono sempre e non si elencano qui.
Gli altri, uno per riga, **con la condizione**, così si sa quando saltarli:
- `nome-del-trasversale` — quando <condizione concreta>
Se la condizione non è scrivibile, quel trasversale non c'entra: toglilo.

## Pagine
`[[slug]]` — gancio di una riga. Solo le pagine di questo dominio.

## Confini
Che cosa **non** sta qui e dove sta invece. È la sezione che fa risparmiare più tempo:
va scritta anche — soprattutto — quando il codice è condiviso.
```

---

## 5. Tetti duri

Fatti rispettare da `lint.py`, che esce con codice ≠ 0.

| oggetto | tetto | perché |
|---|---|---|
| `ROUTER.md` | **≤ 4 KB** | è l'unica cosa iniettata: se sfora, l'harness tronca **in silenzio** e il modello crede di avere una memoria che non ha |
| `MAPPA.md` | **≤ 110 righe** | oltre, non viene letta per intero, e una mappa letta a metà è peggio di nessuna mappa |
| `router:` di una mappa | **≤ 90 caratteri** | è la quota di ogni dominio dentro i 4 KB del router |
| pagina | **300-900 parole** | sotto le 300 è un appunto, non una pagina: accorpala. Sopra le 900 sono due argomenti: **spezzala, non tagliarla** |
| `verificato_il` | **scade a 60 giorni** | avviso, non errore: la pagina va riletta contro il codice |

I tetti sono in **byte**, **righe** e **parole** — mai in token: su questa macchina non esiste un
tokenizer, e un tetto che non si può misurare non è un tetto. I primi tre sono errori (il lint esce
≠ 0); la scadenza della verifica è un avviso, perché una pagina vecchia va riletta ma non impedisce
di lavorare.

### E i tetti che non sono tetti: le due verifiche sulle fonti

`lint.py` non si limita a controllare che il file citato esista. Verifica anche:

- **il numero di riga**: `file.ts:120-180` quando il file ha 100 righe è una citazione scaduta.
  È il modo più comune in cui una pagina «verificata» smette di esserlo senza che nessuno lo veda;
- **la coerenza con `ambiente:`**: se la pagina dichiara di valere in produzione, ogni sua fonte deve
  esistere sul ramo di produzione. È la verifica che una macchina può fare e una persona no, ed è
  dove si concentrava la maggior parte degli errori di questa wiki — pagine che descrivevano la
  produzione avendo sotto gli occhi staging. **Corollario pratico**: un percorso di *migration* non è
  mai una fonte valida per una pagina `[prod, staging]`, perché al port le migration vengono
  rinumerate e il nome non esiste su entrambi i rami. Si cita lo schema, e la doppia numerazione si
  scrive nel corpo.

---

## 6. Vincoli che vengono dalla v1 e non si toccano

Funzionavano. Restano identici.

- **La sorgente immutabile è il codice.** Le pagine **citano** `percorso:riga`, commit, route —
  non incollano mai blocchi di codice. Il codice cambia, la copia no: una copia è una bugia con
  data di scadenza.
- **Mai segreti in chiaro.** Né token, né chiavi, né password, né stringhe di connessione: solo
  puntatori («credenziali nelle env di Coolify», «token in `~/.coolify_token`»). Vale anche nel
  `log.md` e nei nomi dei file.
- **Date assolute** sempre, `YYYY-MM-DD`. Mai «ieri», «la settimana scorsa», «di recente».
- **Confine di ambito**: questa wiki è **solo di questo progetto**. I fatti riutilizzabili
  *cross-progetto* (contatti, convenzioni globali, preferenze del cliente, puntatori a credenziali)
  vanno nella memoria condivisa `~/projects/GENERALE/memoria/`, non qui.
- **`[[slug]]` verso una pagina che non esiste ancora è ammesso**: marca una pagina da scrivere,
  non un errore. `lint.py` lo segnala come *da scrivere*, non come rotto.

---

## 7. Le operazioni

### INGEST — imparare un fatto

Quando emerge un fatto di progetto che **sopravvive alla giornata**:

1. Stabilisci il **dominio**. Se cade fra due, guarda i «Confini» delle due mappe: se il confine non
   è scritto, il fatto che stai per scrivere è proprio quel confine — scrivilo lì.
2. Cerca nella mappa una pagina che già copre il tema. Se c'è, **aggiornala** — non duplicare.
   Aggiorna `aggiornato_il`; aggiorna `verificato_il` **solo se hai davvero guardato il codice**.
3. Altrimenti crea la pagina, col frontmatter completo, e aggiungi la sua riga nella sezione
   «Pagine» della mappa. Una pagina non linkata da nessuna mappa è irraggiungibile: l'indice è
   l'unico canale di scoperta.
4. Se il fatto è un'invariante, una decisione chiusa, una trappola o un confine, va **nella mappa**,
   non in una pagina. Le mappe sono la parte che si legge sempre.
5. Appendi a `log.md`:
   `YYYY-MM-DD ingest — <dominio> — <cosa> → <pagine e mappe toccate>`.
6. Lancia `python3 wiki.llm/lint.py` e sistema ciò che segnala.

### QUERY — rispondere da memoria

È il §2. La regola che conta è l'ultima: **se la wiki non copre, si dice**.

### PORT — la wiki vive su più rami

**`main` e `develop` sono, di fatto, due progetti separati.** Non due stadi dello stesso: due
prodotti che condividono un'origine e da lì hanno preso strade diverse. Una funzione che sta su uno
**non deve** stare sull'altro, e il fatto che diverga non è un debito da sanare. Portare è una
decisione presa una feature alla volta, non un allineamento dovuto.

**Il compito della wiki non è avvicinarli: è dire com'è fatto l'uno e com'è fatto l'altro.** Se una
pagina non permette di capire di quale dei due sta parlando, ha fallito — e quello è il difetto
ricorrente misurato su questa wiki: 21 affermazioni false su 980, in maggioranza «vero su un ramo,
scritto senza dire quale».

**A non dover divergere è solo la memoria.** La wiki è **una sola, identica su tutti i rami**, e
racconta due prodotti. I tre posti in cui si dichiara quale:

- **`ambiente:`** nel frontmatter — dove vale la pagina. `[prod]`, `[staging]` o entrambi;
- **«Differenze prod / staging»**, sezione obbligatoria di ogni mappa — che cosa non è uguale, in
  concreto. «Nessuna» è una risposta valida e va scritta;
- **una riga di prosa nel punto esatto** in cui un comportamento cambia, quando il file esiste su
  entrambi ma si comporta diversamente. È il caso che nessuna macchina può prendere.

`lint.py` verifica le prime due: ogni `fonti:` deve esistere sul ramo che `ambiente:` dichiara
(controllo 3), e il controllo 10 misura la divergenza della sola `wiki.llm/`. **Quel numero è zero
quando la memoria è una sola** — e non dice assolutamente nulla su quanto il codice sia allineato,
che è un'altra faccenda e non è un difetto.

Quindi: quando si porta codice si aggiorna la wiki, e quando si decide di **non** portarlo la si
aggiorna lo stesso — perché la decisione di tenere le due strade separate è essa stessa un fatto da
ricordare, ed è quello che fra sei mesi nessuno si ricorderà da solo.

### ARCHIVIA — mandare in pensione una pagina

Non si cancella niente. Mai `rm`.

1. Sulla pagina che va in pensione: `stato: superato`. Nient'altro.
2. Sulla pagina **nuova** che la sostituisce: `supersede: <slug-vecchio>`.
   Il puntatore va sempre in avanti — dal vivo verso il morto — così si legge partendo da ciò che
   è vero oggi. `lint.py` pretende che ogni pagina archiviata sia richiamata da esattamente una
   pagina viva — o, quando chi la sostituisce non è una pagina (`ROUTER.md`, `SCHEMA.md`), che sia
   la pagina archiviata a dichiararlo da sé con `sostituita_da: <file>`. Un archivio a cui nessuno
   punta è contenuto perso, non contenuto conservato. È un **avviso**: cancellare è irreversibile,
   quindi la decisione resta di una persona.
3. Sposta il file in `_archivio/` (`git mv`, così la storia resta attaccata).
4. Togli la riga dalla sezione «Pagine» della mappa e **scrivi il motivo nel `log.md`**.

Una pagina archiviata resta leggibile e resta trovabile. Serve a rispondere alla domanda «perché
avevamo deciso così?», che è diversa da «come funziona oggi».

### LINT — manutenzione automatica

`python3 wiki.llm/lint.py` — **11 controlli** deterministici (0-10), nessun LLM, exit ≠ 0 se ci sono
errori. `--json` per gli hook. È l'unica cosa che scrive le zone `<!-- AUTO -->` di `ROUTER.md`:
quelle zone **non si toccano a mano**.

Non è un rito da ricordarsi: gira da hook a fine sessione. Un lint che dipende da qualcuno che se lo
ricordi non viene eseguito — misurato: `/lint` non girava da 20 giorni.

**Il linter ha una sua autoverifica**: `python3 wiki.llm/lint-test.py`, 68 casi che costruiscono
wiki finte e controllano che dica esattamente ciò che deve dire. Serve perché i difetti di un linter
non si vedono leggendolo: un falso negativo è indistinguibile dal silenzio. Va rilanciata dopo ogni
modifica a `lint.py`, e prima di portare lo schema su un altro repo.

---

## 8. Confine con le memorie di sessione

Esistono due posti dove finiscono i fatti di questo progetto. Devono avere ruoli diversi, altrimenti
divergono — ed è già successo: cinque coppie di temi con contenuto in contraddizione, e in tre casi
su cinque era la memoria a sbagliare.

**La wiki è l'unica fonte di verità sul progetto.**

**Le memorie di sessione (`~/.claude/projects/<progetto>/memory/`) sono uno scratch a scadenza**:
la cronaca della giornata, lo stato ancora aperto, il «dove eravamo rimasti». Servono a riprendere
domani mattina, non fra sei mesi.

Le due regole:

1. **Ciò che sopravvive alla giornata va promosso nella wiki.** Se un fatto sarà ancora vero fra un
   mese — un'architettura, una decisione chiusa, una trappola, una procedura — non appartiene alle
   memorie: appartiene a un dominio. Promuoverlo significa scriverlo qui e **potare** la memoria,
   lasciando al più un rimando.
2. **Se un tema esiste in entrambi i posti, vince la wiki.** Chi trova una memoria che dice il
   contrario di una pagina non deve arbitrare: aggiorna la wiki se ha verificato sul codice,
   altrimenti pota la memoria.
   Il criterio è verificabile, ed è il controllo 9 di `lint.py`: una memoria che tratta un tema già
   coperto dalla wiki o è stata potata, **o almeno rimanda alla pagina che la supera**. Se non fa
   né l'una né l'altra, sono due verità che invecchiano separate — ed è esattamente così che sono
   nate le cinque coppie divergenti misurate il 2026-08-06, tre delle quali sbagliava la memoria.
   Il lint distingue i due casi e conta quante coppie sono ancora senza rimando. La cancellazione
   resta un gesto umano, perché è irreversibile.

Corollario per chi scrive: **prima di salvare una memoria, chiediti se sarà vera fra un mese.**
Se sì, stai scrivendo nel posto sbagliato.
