#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lint.py — controlli deterministici sulla wiki.llm v2. Nessun LLM, nessuna euristica opaca.

Uso:
    python3 wiki.llm/lint.py                 # referto leggibile, exit 1 se ci sono ERRORI
    python3 wiki.llm/lint.py --json          # stesso referto in JSON (per gli hook)
    python3 wiki.llm/lint.py --no-write      # non riscrive le zone <!-- AUTO --> di ROUTER.md
    python3 wiki.llm/lint.py --quiet         # stampa solo se c'è qualcosa da dire

Contratto:
  - exit 0  → nessun ERRORE (possono esserci AVVISI)
  - exit 1  → almeno un ERRORE
  - exit 2  → la wiki non è dove ci si aspetta (invocazione sbagliata)
  - è l'unica cosa che scrive le zone <!-- AUTO:* --> di ROUTER.md
  - non scrive MAI nulla in git (né add, né commit, né checkout)

Dipendenze: solo la libreria standard. Deve girare su qualunque python3 >= 3.8.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys

# ---------------------------------------------------------------- configurazione

TETTO_ROUTER_BYTE = 4096
TETTO_MAPPA_RIGHE = 110
MIN_PAROLE_PAGINA = 300
MAX_PAROLE_PAGINA = 900
GIORNI_SCADENZA_VERIFICA = 60
MAX_CHAR_ROUTER_LINE = 90          # la riga `router:` di una MAPPA
RAMI_DI_RIFERIMENTO = ["origin/main", "origin/develop"]
# Quale ramo incarna quale ambiente. Serve al controllo 3: una pagina che dichiara
# `ambiente: [prod, staging]` deve avere fonti che esistono su ENTRAMBI i rami — altrimenti
# sta descrivendo la produzione guardando staging, che è l'errore più costoso di questa wiki
# e l'unico che una macchina può scoprire al posto di una persona.
RIF_AMBIENTE = {"prod": "origin/main", "staging": "origin/develop"}
TENANT_TUTTI = "tutti"

TIPI_PAGINA = {"architettura", "dato", "decisione", "procedura", "trappola", "integrazione"}
STATI = {"stabile", "in-evoluzione", "superato"}
AMBIENTI = {"prod", "staging"}
STACK = {"web", "app", "worker"}
DA_VERIFICARE = "da-verificare"

CAMPI_PAGINA = ["name", "description", "dominio", "tipo", "stato",
                "ambiente", "tenant", "stack", "fonti", "aggiornato_il", "verificato_il"]
CAMPI_MAPPA = ["name", "tipo", "dominio", "router", "aggiornato_il", "verificato_il"]

SEZIONI_MAPPA = ["Cos'è", "Superficie di codice", "Invarianti",
                 "Decisioni chiuse", "Trappole note", "Differenze prod / staging",
                 "Comportamento multitenant", "Trasversali da leggere", "Pagine", "Confini"]

# parole troppo generiche per far scattare il confronto wiki ↔ memorie (controllo 9)
STOPWORD = {
    "project", "state", "feedback", "reference", "security", "next", "md", "pro", "re",
    "e", "di", "da", "il", "la", "lo", "le", "i", "gli", "un", "una", "del", "della",
    "dei", "delle", "al", "alla", "in", "con", "su", "per", "tra", "fra", "a", "the",
    "and", "of", "to", "prore", "proremanager", "wiki", "pagina", "pagine", "fix",
    "fixes", "bug", "stato", "nuovo", "nuova", "audit", "sessione", "session",
}

# ------------------------------------------------------- rilevamento credenziali (8)
#
# Due difetti opposti, trovati da una revisione avversariale il 2026-08-06, e come sono
# stati chiusi:
#
#  * FALSO NEGATIVO. La versione precedente saltava l'INTERA RIGA se conteneva una parola
#    da segnaposto («esempio», «TODO», un qualunque `<...>`, «nella env»). Bastava scrivere
#    «Esempio di chiave rifiutata: sk-proj...» perché una credenziale vera passasse. Ora il
#    test del segnaposto si applica al VALORE trovato, non alla riga che lo contiene.
#  * FALSO POSITIVO. La regola generica «password: valore» scattava su
#    `apiKey: process.env.OPENAI_API_KEY` e su `secret: BETTER_AUTH_SECRET`, cioè su prosa
#    tecnica normalissima. Ora un valore è sospetto solo se ha la FORMA di un segreto:
#    lungo, con lettere e cifre insieme, e che non sia un nome di variabile né un accesso
#    a `process.env`. Un controllo che grida sempre viene disattivato, ed è il modo più
#    sicuro di non accorgersi mai di niente.

# Host che non sono un indirizzo pubblico: `localhost`, il loopback, o un nome senza punti
# (un container nella rete interna). Restano avviso, non errore.
# Fonti fuori dal repo dichiarate dal progetto (es. i documenti del cliente che non entrano
# mai in git): si verificano sul filesystem. Valgono solo sulla macchina che le ha.
RADICI_FONTI_ESTERNE = []


# ---------------------------------------------------------------- taratura del progetto
# Le costanti sopra sono quelle del template. Un progetto NON modifica questo file: mette le
# sue in `lint-config.json` accanto a lint.py. Fino al 2026-11-12 ogni repo ne aveva una copia
# ritoccata a mano, 33 copie divergenti, e le correzioni del template non arrivavano più.
# Le chiavi che iniziano con `_` sono note libere (il JSON non ha commenti).
CONFIG_AMMESSE = {
    "TETTO_ROUTER_BYTE": int, "TETTO_MAPPA_RIGHE": int, "MIN_PAROLE_PAGINA": int,
    "MAX_PAROLE_PAGINA": int, "GIORNI_SCADENZA_VERIFICA": int, "MAX_CHAR_ROUTER_LINE": int,
    "RAMI_DI_RIFERIMENTO": list, "RIF_AMBIENTE": dict, "TENANT_TUTTI": str,
    "AMBIENTI": set, "STACK": set, "RADICI_FONTI_ESTERNE": list,
    "STOPWORD_EXTRA": set,          # si AGGIUNGONO a STOPWORD
    "SEZIONE_DIFFERENZE": str,      # sostituisce «Differenze prod / staging» in SEZIONI_MAPPA
}
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lint-config.json")


def _applica_config(percorso=CONFIG_FILE):
    global STOPWORD, SEZIONI_MAPPA
    if not os.path.isfile(percorso):
        return
    try:
        cfg = json.load(open(percorso, encoding="utf-8"))
    except ValueError as e:
        sys.exit(f"lint-config.json non è JSON valido: {e}")
    for k, v in cfg.items():
        if k.startswith("_"):
            continue
        tipo = CONFIG_AMMESSE.get(k)
        if tipo is None:
            sys.exit(f"lint-config.json: chiave sconosciuta «{k}». Ammesse: {', '.join(sorted(CONFIG_AMMESSE))}")
        if tipo is set:
            v = set(v)
        elif not isinstance(v, tipo):
            sys.exit(f"lint-config.json: «{k}» deve essere {tipo.__name__}")
        if k == "STOPWORD_EXTRA":
            STOPWORD = set(STOPWORD) | v
        elif k == "SEZIONE_DIFFERENZE":
            SEZIONI_MAPPA = [v if s == "Differenze prod / staging" else s for s in SEZIONI_MAPPA]
        else:
            globals()[k] = v


_applica_config()

RE_HOST_LOCALE = re.compile(r"^(localhost|127\.0\.0\.1|\[?::1\]?|[A-Za-z0-9_-]+)$")
RE_URL_CON_PASSWORD = re.compile(
    r"\b[a-z][a-z0-9+.\-]*://[^\s/:@]+:[^\s/@]{4,}@([^\s/:?\"'`]+)")

RE_SEGRETI = [
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"), "chiave stile OpenAI (sk-…)"),
    (re.compile(r"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}"), "chiave Stripe (sk_live_…)"),
    (re.compile(r"\bwhsec_[A-Za-z0-9]{16,}"), "segreto webhook Stripe (whsec_…)"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
     "JWT in chiaro"),
    (re.compile(r"\bghp_[A-Za-z0-9]{20,}"), "token GitHub (ghp_…)"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "token GitHub (github_pat_…)"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), "token Slack (xox…)"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "access key AWS (AKIA…)"),
    (re.compile(r"\bEAA[A-Za-z0-9]{40,}"), "token Meta/Graph (EAA…)"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "chiave privata in chiaro"),
    (re.compile(r"(?i)\b(?:authorization|bearer)\s*:?\s+(?:Bearer\s+)?"
                r"([A-Za-z0-9_\-\.]{24,})"), "token in un header"),
]

# La regola generica: `chiave = valore`. Il valore deve AVERE LA FORMA di un segreto.
# ⚠️ Niente `\b` davanti all'alternanza: in `META_APP_SECRET` il carattere che precede
# `SECRET` è `_`, che NON è un confine di parola — quindi con `\b` la regex non agganciava
# mai nessuna chiave composta (`META_APP_SECRET`, `client_secret`, `PGPASSWORD`), cioè
# proprio le più probabili in questo progetto. Si ancora invece all'inizio riga o a un
# separatore, e si accetta qualunque prefisso di parola.
# Etichetta seguita SUBITO dal valore fra backtick o apici, senza `:` né `=`. È la forma della
# prosa italiana — «name `x`, user `y`, pass `z`» — con cui la password del DB di produzione è
# passata inosservata mentre la chiave AWS sulla riga adiacente veniva segnalata (2026-08-07).
# L'etichetta deve toccare il valore: «token Sanctum `atelier-bridge`» NON è un segreto in chiaro.
RE_ETICHETTA_VALORE = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|api[_-]?key|token|credential|pass|chiave)\b"
    r"\s*[:=]?\s*[`\"']([^`\"'\s]{8,})[`\"']")

RE_ASSEGNAZIONE = re.compile(
    r"(?i)(?:^|[\s\"'`,;({\[])[A-Za-z0-9_\-]*"
    r"(password|passwd|pwd|secret|api[_-]?key|token|credential|pass)"
    r"[A-Za-z0-9_\-]*(?:\s+[A-Za-z0-9_\-]+){0,2}"     # «token Coolify: …» è ancora un'assegnazione
    r"\s*[:=]\s*[\"'`]?([^\s\"'`,;)\]]{10,})")

# Un valore NON è un segreto se è: un nome di variabile d'ambiente, un accesso a
# process.env, un percorso, un segnaposto, o una sola parola senza cifre.
# Un valore NON è un segreto se è un nome di variabile, un accesso a env, un percorso, un
# segnaposto o una parola. ⚠️ Il MAIUSCOLO da solo non basta a esentare: `ABCDEF0123456789…`
# è maiuscolo ed è una credenziale. Si esenta solo il maiuscolo *corto* o *con underscore*,
# che è la forma dei nomi di variabile d'ambiente.
RE_NON_SEGRETO = re.compile(
    r"^(?:[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z][A-Z0-9]{0,19}"
    r"|process\.env\..*|import\.meta\..*|\$\{?[A-Za-z_].*"
    r"|[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*\(.*"      # una chiamata di funzione
    r"|[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)+"           # un identificatore puntato
    r"|[./~][^\s]*|<[^>]*>|\.{3,}|[Xx]{3,}|null|undefined|true|false"
    r"|[A-Za-z][A-Za-z_-]{0,14})$")                              # una parola, non una passphrase
SEGNAPOSTO = re.compile(r"(?i)^(xxx+|\.{3,}|<[^>]*>|todo|esempio|placeholder|redacted|"
                        r"il-valore|valore|omesso|rimosso)")


def _valore_ha_forma_di_segreto(v):
    """
    Lungo e non riconducibile a un nome, a un percorso o a un segnaposto.
    Due forme bastano: lettere+cifre insieme (la stragrande maggioranza dei token), oppure
    una stringa lunga senza spazi con maiuscole e minuscole miste — cioè una passphrase,
    che prima passava perché si pretendeva almeno una cifra.
    """
    if len(v) < 10 or RE_NON_SEGRETO.match(v) or SEGNAPOSTO.match(v):
        return False
    if any(op in v for op in ("?.", "||", "=>", "&&")):
        return False
    misto = any(c.isdigit() for c in v) and any(c.isalpha() for c in v)
    passphrase = (len(v) >= 16 and any(c.isupper() for c in v)
                  and any(c.islower() for c in v))
    return misto or passphrase


# ------------------------------------------------------------------- utilità base


def eprint(*a):
    print(*a, file=sys.stderr)


def leggi(p):
    """
    Non solleva mai. Un file in una codifica strana, o una directory che finisce in `.md`,
    non devono far morire il lint: gira dentro un hook, e un hook che muore con `--json`
    lascia l'output vuoto proprio quando avrebbe dovuto segnalare qualcosa.
    """
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except (IsADirectoryError, PermissionError, OSError):
        return ""


def _tutti_i_file(radice, estensioni):
    out = []
    for base, _, files in os.walk(radice):
        for f in files:
            if f.endswith(estensioni):
                out.append(os.path.join(base, f))
    return out


def sezione(corpo, titolo):
    """
    Il corpo di una sezione `## <titolo>`, fino alla successiva `##`.

    Tollerante sul titolo: `## Pagine`, `## Pagine (2)` e
    `## Decisioni chiuse ⛔ non ridiscutere` sono la stessa sezione. Un matcher rigido
    faceva sparire in silenzio i controlli 2, 5 e 7 appena qualcuno decorava un titolo —
    e un controllo che si spegne senza dirlo è peggio di un controllo che non c'è.
    """
    corpo = corpo.replace("\u2019", "'")
    m = re.search(r"^##\s+" + re.escape(titolo) + r"\b.*?$(.*?)(?=^##\s|\Z)",
                  corpo, re.S | re.M)
    return m.group(1) if m else None


def spezza_frontmatter(testo):
    """Restituisce (dict_frontmatter, corpo). dict vuoto se manca."""
    if not testo.startswith("---"):
        return {}, testo
    fine = testo.find("\n---", 3)
    if fine == -1:
        return {}, testo
    blocco = testo[3:fine]
    corpo = testo[fine + 4:]
    return parse_yaml_minimale(blocco), corpo


def parse_yaml_minimale(blocco):
    """
    Sottoinsieme di YAML sufficiente al frontmatter: `k: v`, `k: [a, b]`,
    `k:` seguito da righe `  - v`. Nessuna dipendenza esterna, nessuna sorpresa.
    """
    out, chiave_lista = {}, None
    for riga in blocco.splitlines():
        if not riga.strip() or riga.lstrip().startswith("#"):
            continue
        if riga.lstrip().startswith("- ") and chiave_lista:
            out[chiave_lista].append(pulisci(riga.lstrip()[2:]))
            continue
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$", riga)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if v == "":
            out[k] = []
            chiave_lista = k
        elif v.startswith("[") and v.endswith("]"):
            dentro = v[1:-1].strip()
            out[k] = [pulisci(x) for x in dentro.split(",") if x.strip()] if dentro else []
            chiave_lista = None
        else:
            out[k] = pulisci(v)
            chiave_lista = None
    return out


def pulisci(v):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    return v.strip()


def senza_codice(testo):
    """Toglie i blocchi ``` e il codice inline: evita di leggere gli esempi come contenuto."""
    testo = re.sub(r"```.*?```", " ", testo, flags=re.S)
    testo = re.sub(r"`[^`\n]*`", " ", testo)
    return testo


def come_data(v):
    try:
        return datetime.date.fromisoformat(str(v))
    except Exception:
        return None


def token_significativi(nome):
    grezzi = re.split(r"[^a-z0-9]+", nome.lower())
    return {t for t in grezzi if len(t) > 2 and t not in STOPWORD and not t.isdigit()}


# ------------------------------------------------------------------ raccolta file


class Wiki:
    def __init__(self, radice):
        self.radice = radice
        self.repo = os.path.dirname(radice)
        self.pagine = {}      # slug -> dict
        self.mappe = {}       # nome -> dict
        self.archivio = {}    # slug -> dict
        self.duplicati = []
        self._carica()

    def _carica(self):
        for gruppo in ("domini", "trasversali"):
            base = os.path.join(self.radice, gruppo)
            if not os.path.isdir(base):
                continue
            for nome in sorted(os.listdir(base)):
                cart = os.path.join(base, nome)
                if not os.path.isdir(cart):
                    continue
                mp = os.path.join(cart, "MAPPA.md")
                if os.path.isfile(mp):
                    fm, corpo = spezza_frontmatter(leggi(mp))
                    self.mappe[nome] = {
                        "nome": nome, "gruppo": gruppo, "path": mp, "rel": self.rel(mp),
                        "fm": fm, "corpo": corpo, "righe": len(leggi(mp).splitlines()),
                    }
                else:
                    self.mappe[nome] = {"nome": nome, "gruppo": gruppo, "path": mp,
                                        "rel": self.rel(mp), "fm": None, "corpo": "",
                                        "righe": 0}
                pag = os.path.join(cart, "pagine")
                if not os.path.isdir(pag):
                    continue
                for f in sorted(os.listdir(pag)):
                    if not f.endswith(".md"):
                        continue
                    self._aggiungi(self.pagine, os.path.join(pag, f), gruppo, nome)

        # Le mappe si conoscono solo a caricamento finito: `domini/` viene letto prima di
        # `trasversali/`, quindi un confronto fatto durante la lettura dipenderebbe
        # dall'ordine alfabetico delle cartelle.
        for slug, voce in list(self.pagine.items()):
            if slug in self.mappe:
                self.duplicati.append((slug, voce["rel"]))

        arc = os.path.join(self.radice, "_archivio")
        if os.path.isdir(arc):
            for f in sorted(os.listdir(arc)):
                if f.endswith(".md"):
                    self._aggiungi(self.archivio, os.path.join(arc, f), "_archivio", None)

    def _aggiungi(self, dove, path, gruppo, cartella):
        slug = os.path.basename(path)[:-3]
        testo = leggi(path)
        fm, corpo = spezza_frontmatter(testo)
        voce = {
            "slug": slug, "path": path, "rel": self.rel(path), "gruppo": gruppo,
            "cartella": cartella, "fm": fm, "corpo": corpo,
            "parole": len(corpo.split()),
        }
        if slug in dove or slug in self.pagine or slug in self.archivio:
            self.duplicati.append((slug, self.rel(path)))
            # Non sovrascrivere: il duplicato verrebbe segnalato, ma solo UNO dei due file
            # passerebbe poi per gli altri controlli, e l'altro sfuggirebbe a fonti, parole
            # e scadenze. Si conserva con una chiave distinta.
            slug = slug + "\u0000" + self.rel(path)
        dove[slug] = voce

    def rel(self, p):
        return os.path.relpath(p, self.repo)

    @property
    def tutti_gli_slug(self):
        s = set(self.pagine) | set(self.archivio) | set(self.mappe)
        return s


# ---------------------------------------------------------------------- controlli


class Referto:
    def __init__(self):
        self.voci = []

    def err(self, cid, dove, msg):
        self.voci.append({"livello": "ERRORE", "controllo": cid, "dove": dove, "msg": msg})

    def avv(self, cid, dove, msg):
        self.voci.append({"livello": "AVVISO", "controllo": cid, "dove": dove, "msg": msg})

    @property
    def errori(self):
        return [v for v in self.voci if v["livello"] == "ERRORE"]

    @property
    def avvisi(self):
        return [v for v in self.voci if v["livello"] == "AVVISO"]


NOMI_CONTROLLI = {
    0: "frontmatter e struttura",
    1: "peso di ROUTER.md",
    2: "tetti di MAPPA e pagina",
    3: "fonti che non esistono più",
    4: "verifiche scadute",
    5: "pagine orfane",
    6: "collegamenti [[...]] senza destinazione",
    7: "mappa disallineata dal disco",
    8: "possibili credenziali",
    9: "temi doppi wiki / memorie",
    10: "divergenza fra i rami git",
}


def controllo_0_struttura(w, r):
    for slug, rel in w.duplicati:
        r.err(0, rel, f"slug duplicato: «{slug}» esiste già altrove. Gli slug sono unici in tutta la wiki")

    for nome, m in sorted(w.mappe.items()):
        if m["fm"] is None:
            r.err(0, m["rel"], "MAPPA.md mancante per questa cartella")
            continue
        fm = m["fm"]
        for c in CAMPI_MAPPA:
            if c not in fm or fm[c] in ("", [], None):
                r.err(0, m["rel"], f"campo obbligatorio mancante nel frontmatter: `{c}`")
        if fm.get("name") != nome:
            r.err(0, m["rel"], f"`name: {fm.get('name')}` diverso dal nome della cartella «{nome}»")
        if fm.get("tipo") != "mappa":
            r.err(0, m["rel"], "una MAPPA deve avere `tipo: mappa`")
        if fm.get("dominio") != nome:
            r.err(0, m["rel"], f"`dominio: {fm.get('dominio')}` diverso da «{nome}»")
        rt = fm.get("router", "")
        if isinstance(rt, str) and len(rt) > MAX_CHAR_ROUTER_LINE:
            r.err(0, m["rel"],
                  f"`router:` lungo {len(rt)} caratteri, il tetto è {MAX_CHAR_ROUTER_LINE}: "
                  "ogni carattere finisce in ROUTER.md, che ha un budget")
        for d in ("aggiornato_il", "verificato_il"):
            if fm.get(d) and come_data(fm[d]) is None:
                r.err(0, m["rel"], f"`{d}: {fm[d]}` non è una data YYYY-MM-DD")
        posizioni = []
        for sez in SEZIONI_MAPPA:
            if sezione(m["corpo"], sez) is None:
                r.err(0, m["rel"], f"sezione obbligatoria mancante: «## {sez}»")
            else:
                posizioni.append((m["corpo"].replace("\u2019", "'").index(sezione(m["corpo"], sez)), sez))
        if posizioni != sorted(posizioni):
            atteso = " → ".join(s for _, s in sorted(posizioni, key=lambda x: SEZIONI_MAPPA.index(x[1])))
            r.err(0, m["rel"], f"le sezioni non sono nell'ordine prescritto. Atteso: {atteso}")

    for slug, p in sorted(w.pagine.items()):
        fm = p["fm"]
        if not fm:
            r.err(0, p["rel"], "frontmatter assente")
            continue
        for c in CAMPI_PAGINA:
            if c not in fm or fm[c] in ("", None) or (c != "fonti" and fm[c] == []):
                r.err(0, p["rel"], f"campo obbligatorio mancante nel frontmatter: `{c}`")
        if fm.get("name") != slug:
            r.err(0, p["rel"], f"`name: {fm.get('name')}` diverso dal nome del file «{slug}»")
        if fm.get("dominio") != p["cartella"]:
            r.err(0, p["rel"],
                  f"`dominio: {fm.get('dominio')}` ma la pagina sta in «{p['cartella']}»")
        t = fm.get("tipo")
        if t and t != DA_VERIFICARE and t not in TIPI_PAGINA:
            r.err(0, p["rel"], f"`tipo: {t}` non ammesso ({'|'.join(sorted(TIPI_PAGINA))})")
        s = fm.get("stato")
        if s and s not in STATI:
            r.err(0, p["rel"], f"`stato: {s}` non ammesso ({'|'.join(sorted(STATI))})")
        if s == "superato":
            r.err(0, p["rel"], "`stato: superato` ma la pagina è ancora viva: va spostata in `_archivio/`")
        ten = fm.get("tenant")
        if isinstance(ten, str) and ten not in (TENANT_TUTTI, DA_VERIFICARE):
            r.err(0, p["rel"],
                  f"`tenant: {ten}` non ammesso: o «{TENANT_TUTTI}», o una lista di slug "
                  "fra parentesi quadre")
        amb = fm.get("ambiente")
        if isinstance(amb, list):
            for a in amb:
                if a not in AMBIENTI and a != DA_VERIFICARE:
                    r.err(0, p["rel"], f"`ambiente` contiene «{a}» ({'|'.join(sorted(AMBIENTI))})")
        st = fm.get("stack")
        if isinstance(st, list):
            for a in st:
                if a not in STACK and a != DA_VERIFICARE:
                    r.err(0, p["rel"], f"`stack` contiene «{a}» ({'|'.join(sorted(STACK))})")
        for d in ("aggiornato_il", "verificato_il"):
            v = fm.get(d)
            if v and v != DA_VERIFICARE and come_data(v) is None:
                r.err(0, p["rel"], f"`{d}: {v}` non è una data YYYY-MM-DD")
        for campo in CAMPI_PAGINA:
            v = fm.get(campo)
            if v == DA_VERIFICARE or (isinstance(v, list) and DA_VERIFICARE in v):
                r.avv(0, p["rel"], f"`{campo}: da-verificare` — resta da compilare")

    # archivio: stato superato obbligatorio, e qualcuno deve puntarci
    puntati = set()
    for p in list(w.pagine.values()):
        sup = p["fm"].get("supersede") if p["fm"] else None
        for s in ([sup] if isinstance(sup, str) else (sup or [])):
            if s:
                puntati.add(s)
    for p in sorted(w.pagine.values(), key=lambda x: x["rel"]):
        sup = p["fm"].get("supersede") if p["fm"] else None
        for s in ([sup] if isinstance(sup, str) else (sup or [])):
            if s and s not in w.archivio:
                r.err(0, p["rel"],
                      f"`supersede: {s}` non corrisponde a nessuna pagina in `_archivio/`")

    for slug, p in sorted(w.archivio.items()):
        if not p["fm"]:
            r.err(0, p["rel"], "pagina archiviata senza frontmatter")
            continue
        if p["fm"].get("stato") != "superato":
            r.err(0, p["rel"], "pagina in `_archivio/` senza `stato: superato`")
        # Il puntatore normale va in avanti, da una pagina viva a quella morta. L'unica
        # eccezione è quando chi la sostituisce non è una pagina (ROUTER.md, SCHEMA.md):
        # allora la pagina archiviata lo dichiara da sé con `sostituita_da:`.
        sost_da = p["fm"].get("sostituita_da")
        if sost_da and not os.path.exists(os.path.join(w.radice, sost_da)):
            r.err(0, p["rel"], f"`sostituita_da: {sost_da}` non esiste dentro `wiki.llm/`")
        elif slug not in puntati and not sost_da:
            r.avv(0, p["rel"],
                  "nessuna pagina viva la richiama con `supersede:` e non dichiara "
                  "`sostituita_da:` — un archivio a cui nessuno punta è contenuto perso, "
                  "non contenuto conservato")


def controllo_1_router(w, r):
    p = os.path.join(w.radice, "ROUTER.md")
    if not os.path.isfile(p):
        r.err(1, w.rel(p), "ROUTER.md non esiste: è l'unica cosa iniettata a SessionStart")
        return 0
    n = os.path.getsize(p)
    if n > TETTO_ROUTER_BYTE:
        r.err(1, w.rel(p),
              f"{n} byte, tetto {TETTO_ROUTER_BYTE}. Oltre il budget l'iniezione viene "
              "troncata in silenzio e la sessione crede di avere una memoria che non ha")
    elif n > TETTO_ROUTER_BYTE * 0.9:
        # Il tetto lo si sfonda aggiungendo un dominio, cioè tutto in una volta: un
        # preavviso serve mentre c'è ancora spazio per accorciare, non dopo.
        r.avv(1, w.rel(p),
              f"{n} byte su {TETTO_ROUTER_BYTE}: restano {TETTO_ROUTER_BYTE - n}. "
              "Il prossimo dominio non ci sta — accorcia le righe `router:` delle mappe")
    return n


MANDATORI = {"multitenancy", "auth-e-permessi"}


def controllo_2_tetti(w, r):
    # I trasversali condizionati sono il costo ricorrente più alto di una sessione: se
    # sono elencati senza condizione la sessione li legge tutti, e la regola muore.
    for nome, m in sorted(w.mappe.items()):
        if m["fm"] is None:
            continue
        sez = sezione(m["corpo"], "Trasversali da leggere")
        if sez is None:
            continue
        for riga in sez.splitlines():
            riga = riga.strip()
            if not riga.startswith("- "):
                continue
            nomi = re.findall(r"`([a-z0-9\-]+)`", riga)
            cond = re.split(r"\s[—–-]\s|`\s*:\s+", riga, maxsplit=1)
            if not nomi:
                continue
            if nomi[0] in MANDATORI:
                r.avv(2, m["rel"],
                      f"`{nomi[0]}` è già di lettura obbligatoria: elencarlo qui non aggiunge nulla")
            elif len(cond) < 2 or len(cond[1].strip()) < 15:
                r.err(2, m["rel"],
                      f"`{nomi[0]}` è elencato senza condizione. Senza un «quando», la sessione "
                      "lo legge sempre: ~6 KB a mappa, e la regola viene abbandonata")
    for nome, m in sorted(w.mappe.items()):
        if m["fm"] is None:
            continue
        if m["righe"] > TETTO_MAPPA_RIGHE:
            r.err(2, m["rel"], f"{m['righe']} righe, tetto {TETTO_MAPPA_RIGHE}: "
                               "una mappa più lunga non viene letta per intero")
    for slug, p in sorted(w.pagine.items()):
        n = p["parole"]
        if n < MIN_PAROLE_PAGINA:
            r.err(2, p["rel"], f"{n} parole, minimo {MIN_PAROLE_PAGINA}: "
                               "è un appunto, va accorpato a una pagina esistente")
        elif n > MAX_PAROLE_PAGINA:
            r.err(2, p["rel"], f"{n} parole, massimo {MAX_PAROLE_PAGINA}: "
                               "sono due argomenti, va spezzata (non tagliata)")


def controllo_3_fonti(w, r):
    repo = w.repo
    for slug, p in sorted(list(w.pagine.items()) + list(w.archivio.items())):
        if not p["fm"]:
            continue
        fonti = p["fm"].get("fonti") or []
        if isinstance(fonti, str):
            fonti = [fonti]
        if not fonti and not p["rel"].startswith(os.path.join("wiki.llm", "_archivio")):
            r.err(3, p["rel"], "`fonti:` è presente ma vuota: una pagina senza fonti non è "
                               "verificabile da nessuno")
        for f in fonti:
            if f == DA_VERIFICARE:
                continue
            percorso = f.split(":")[0].strip()
            if not percorso:
                continue
            # Fonte esterna dichiarata (vedi RADICI_FONTI_ESTERNE): si verifica sul
            # filesystem, non su git. Non ha rami né righe: o il file c'è, o non c'è.
            if any(percorso.startswith(radice) for radice in RADICI_FONTI_ESTERNE):
                if not os.path.exists(os.path.expanduser(percorso)):
                    r.err(3, p["rel"],
                          f"fonte esterna «{f}»: `{percorso}` non esiste su questa macchina. "
                          "O il file è stato spostato, o la citazione è sbagliata")
                continue
            if os.path.isabs(percorso):
                r.err(3, p["rel"],
                      f"fonte «{f}»: è un percorso assoluto. Le fonti sono relative alla "
                      "radice del repo, altrimenti valgono solo su questa macchina")
                continue
            # Un nome senza barre è ambiguo *solo se* non è un file della radice del repo:
            # `next.config.ts`, `package.json`, `Dockerfile` sono percorsi completi e legittimi.
            # Prima questo controllo li rifiutava tutti, e rifiutava proprio i file di
            # configurazione — che sono fra le fonti più citate.
            if "/" not in percorso and not os.path.exists(os.path.join(repo, percorso)):
                r.err(3, p["rel"],
                      f"fonte «{f}»: è un nome nudo, non un percorso dalla radice del repo. "
                      "Nel repo esistono file omonimi: nessuna macchina può verificarla")
                continue
            # Quale ramo fa fede. La wiki vive su PIÙ rami contemporaneamente: giudicare una
            # fonte guardando il checkout su cui si è seduti significa dare esiti diversi
            # allo stesso contenuto a seconda di dove lo si controlla — e una pagina che
            # dichiara `ambiente: [staging]` risulterebbe rotta letta da produzione.
            # Fa fede l'ambiente DICHIARATO; il filesystem è solo il ripiego.
            amb = p["fm"].get("ambiente")
            amb = amb if isinstance(amb, list) else ([amb] if amb else [])
            refs = [(a, RIF_AMBIENTE[a]) for a in amb if a in RIF_AMBIENTE]
            refs = [(a, ref) for a, ref in refs if esiste_su(repo, ref, percorso) is not None]

            if refs:
                mancanti = [(a, ref) for a, ref in refs if not esiste_su(repo, ref, percorso)]
                if len(mancanti) == len(refs):
                    r.err(3, p["rel"],
                          f"fonte «{f}»: `{percorso}` non esiste su nessuno dei rami dichiarati "
                          f"({', '.join(ref for _, ref in refs)})")
                    continue
                for a, ref in mancanti:
                    r.err(3, p["rel"],
                          f"fonte «{percorso}» non esiste su `{ref}`, ma la pagina dichiara "
                          f"`ambiente: {a}`. O la fonte è sbagliata, o l'ambiente lo è")
            elif not os.path.exists(os.path.join(repo, percorso)):
                r.err(3, p["rel"], f"fonte «{f}»: `{percorso}` non esiste su questo ramo, "
                                   "e la pagina non dichiara un ambiente su cui verificarla")
                continue

            # Il numero di riga: una citazione `file:120-180` che punta oltre la fine del
            # file è scaduta, e finora scadeva in silenzio. È il modo più comune in cui una
            # pagina «verificata» smette di esserlo senza che nessuno se ne accorga.
            # La riga vale se regge su ALMENO UNO dei rami che la pagina dichiara di
            # coprire. Pretenderla su tutti garantirebbe rumore per ogni file che diverge;
            # non pretenderla su nessuno la lascerebbe scadere in silenzio. Se non regge da
            # nessuna parte, la citazione è morta e basta.
            m = re.search(r":(\d+)(?:-(\d+))?\s*$", f.strip())
            if m:
                ultima = int(m.group(2) or m.group(1))
                lunghezze = [righe_di(repo, percorso, ref) for _, ref in refs] or \
                            [righe_di(repo, percorso)]
                lunghezze = [n for n in lunghezze if n is not None]
                if lunghezze and all(ultima > n for n in lunghezze):
                    dove = ", ".join(f"{ref} {n} righe" for (_, ref), n in zip(refs, lunghezze)) \
                        if refs else f"{lunghezze[0]} righe"
                    r.err(3, p["rel"],
                          f"fonte «{f}»: la citazione arriva alla riga {ultima}, ma il file "
                          f"non ci arriva su nessun ramo dichiarato ({dove}). La riga è scaduta")



def controllo_4_scadenze(w, r, oggi):
    # Anche le mappe: sono l'unica cosa letta per intero a ogni ingresso nel dominio, e il
    # loro `verificato_il` finisce perfino nella colonna `ver` di ROUTER.md.
    tutte = list(w.pagine.values()) + [m for m in w.mappe.values() if m["fm"]]
    for p in sorted(tutte, key=lambda x: x["rel"]):
        if not p["fm"]:
            continue
        v = p["fm"].get("verificato_il")
        if not v or v == DA_VERIFICARE:
            continue
        d = come_data(v)  # noqa: E501
        if d is None:
            continue
        eta = (oggi - d).days
        if eta > GIORNI_SCADENZA_VERIFICA:
            r.avv(4, p["rel"],
                  f"verificata l'ultima volta {eta} giorni fa ({v}), soglia "
                  f"{GIORNI_SCADENZA_VERIFICA}: va riletta contro il codice")


def _pagine_citate_dalla_mappa(m):
    """
    Solo la sezione `## Pagine` fa da indice. Altrove — e soprattutto in `## Confini` —
    i rimandi a pagine di altri domini sono legittimi e non vanno confusi con l'indice:
    un lint che li rifiuta costringe a scrivere i confini in prosa, cioè a togliere
    proprio i collegamenti che servono per cambiare dominio senza cercare.
    """
    return set(re.findall(r"\[\[([a-z0-9\-]+)\]\]", sezione(m["corpo"], "Pagine") or ""))


def controllo_5_orfane(w, r):
    citate = set()
    for m in w.mappe.values():
        citate |= _pagine_citate_dalla_mappa(m)
    for slug, p in sorted(w.pagine.items()):
        if slug not in citate:
            r.err(5, p["rel"],
                  "nessuna mappa la elenca: è irraggiungibile, perché la mappa è l'unico "
                  "canale di scoperta")


def controllo_6_link(w, r):
    esistenti = w.tutti_gli_slug
    sorgenti = []
    for p in list(w.pagine.values()) + list(w.archivio.values()):
        sorgenti.append((p["rel"], p["corpo"]))
    for m in w.mappe.values():
        sorgenti.append((m["rel"], m["corpo"]))
    router = os.path.join(w.radice, "ROUTER.md")
    if os.path.isfile(router):
        sorgenti.append((w.rel(router), leggi(router)))
    # SCHEMA.md e PORTING.md sono esclusi: contengono esempi di sintassi, non collegamenti
    vivi = {p["rel"] for p in w.pagine.values()} | {m["rel"] for m in w.mappe.values()}
    for rel, testo in sorgenti:
        for target in sorted(set(re.findall(r"\[\[([^\]\n]+)\]\]", senza_codice(testo)))):
            if target not in esistenti:
                r.avv(6, rel, f"`[[{target}]]` non ha destinazione: pagina da scrivere, oppure refuso")
            elif target in w.archivio and rel in vivi:
                sost = [p["slug"] for p in w.pagine.values()
                        if p["fm"] and p["fm"].get("supersede") == target]
                dove = f" → ripuntalo a `[[{sost[0]}]]`" if len(sost) == 1 else ""
                r.avv(6, rel, f"`[[{target}]]` punta a una pagina archiviata{dove}")


def controllo_7_mappa_vs_disco(w, r):
    per_cartella = {}
    for p in w.pagine.values():
        per_cartella.setdefault(p["cartella"], set()).add(p["slug"])
    for nome, m in sorted(w.mappe.items()):
        if m["fm"] is None:
            continue
        citate = _pagine_citate_dalla_mappa(m)
        sul_disco = per_cartella.get(nome, set())
        for slug in sorted(citate - w.tutti_gli_slug):
            r.err(7, m["rel"], f"la mappa elenca `[[{slug}]]`, che non esiste da nessuna parte")
        for slug in sorted(sul_disco - citate):
            r.err(7, m["rel"], f"`{slug}.md` è sul disco in questa cartella ma la mappa non lo elenca")
        for slug in sorted(citate & w.tutti_gli_slug):
            if slug in w.pagine and w.pagine[slug]["cartella"] != nome:
                r.err(7, m["rel"],
                      f"la mappa elenca `[[{slug}]]`, che però vive in "
                      f"«{w.pagine[slug]['cartella']}»: si cita con un rimando, non nell'elenco")


def controllo_8_segreti(w, r):
    for path in sorted(_tutti_i_file(w.radice, (".md", ".py"))):
        if os.path.basename(path) in ("lint.py", "lint-test.py"):
            # Il linter contiene le regex, e la sua autoverifica contiene le credenziali
            # FINTE con cui si prova che il controllo funziona. Escluderli è necessario;
            # è anche l'unica esclusione, e vale per nome esatto, non per cartella.
            continue
        for i, riga in enumerate(leggi(path).splitlines(), 1):
            dove = f"{w.rel(path)}:{i}"

            for rx, che_cosa in RE_SEGRETI:
                m = rx.search(riga)
                if m and not SEGNAPOSTO.match(m.group(0)):
                    r.err(8, dove, f"{che_cosa} — mai segreti in chiaro, solo puntatori")
                    break

            m = RE_URL_CON_PASSWORD.search(riga)
            if m:
                host = m.group(1).split(":")[0]
                if RE_HOST_LOCALE.match(host):
                    r.avv(8, dove, "URL con password verso un host locale o un container "
                                   "(comando di sviluppo) — meglio un puntatore anche qui")
                else:
                    r.err(8, dove, "URL con password verso un host non locale — "
                                   "mai segreti in chiaro, solo puntatori")

            m = RE_ETICHETTA_VALORE.search(riga)
            if m and _valore_ha_forma_di_segreto(m.group(2)):
                r.err(8, dove, f"`{m.group(1)}` seguito da un valore fra apici che ha la forma "
                               "di una credenziale — mai segreti in chiaro, solo puntatori")
                continue

            m = RE_ASSEGNAZIONE.search(riga)
            if m and _valore_ha_forma_di_segreto(m.group(2)):
                r.err(8, dove, f"`{m.group(1)}` con un valore che ha la forma di una "
                               "credenziale — mai segreti in chiaro, solo puntatori")


def controllo_9_temi_doppi(w, r, dir_memorie):
    if not dir_memorie or not os.path.isdir(dir_memorie):
        r.avv(9, "-", "cartella delle memorie di sessione non trovata: controllo saltato")
        return []
    memorie = []
    for base, _, files in os.walk(dir_memorie):
        for f in files:
            if f.endswith(".md") and f != "MEMORY.md":
                memorie.append(os.path.join(base, f))
    coppie = []
    for slug, p in sorted(w.pagine.items()):
        tw = token_significativi(slug)
        if len(tw) < 2:
            continue
        for mpath in memorie:
            tm = token_significativi(os.path.basename(mpath)[:-3])
            comuni = tw & tm
            if len(comuni) >= 2:
                coppie.append({"pagina": p["rel"], "memoria": os.path.relpath(mpath, dir_memorie),
                               "in_comune": sorted(comuni)})
    for c in coppie:
        # Il criterio di potatura, verificabile: una memoria che tratta un tema già coperto
        # dalla wiki o è stata potata, o almeno **punta** alla pagina che la supera. Se non
        # fa nessuna delle due, è una seconda verità che vive per conto suo — ed è così che
        # sono nate le cinque coppie divergenti misurate il 2026-08-06.
        testo = leggi(os.path.join(dir_memorie, c["memoria"]))
        c["punta_alla_wiki"] = (c["pagina"] in testo
                                or os.path.basename(c["pagina"])[:-3] in testo)
        if c["punta_alla_wiki"]:
            r.avv(9, c["pagina"],
                  f"`{c['memoria']}` tratta lo stesso tema ma **rimanda già qui**: "
                  "resta da potare ciò che duplica, non da riconciliare")
        else:
            r.avv(9, c["pagina"],
                  f"`{c['memoria']}` tratta lo stesso tema ({', '.join(c['in_comune'])}) e "
                  "**non rimanda a questa pagina**: due verità che invecchiano separate. "
                  "Verifica quale è vera, correggi la wiki se serve, e lascia nella memoria "
                  "un rimando al posto della copia")
    return coppie


_CACHE_GIT = {}


def esiste_su(repo, ref, percorso):
    """Il file esiste su quel ref? None se il ref non è raggiungibile (allora non si giudica)."""
    if ref not in _CACHE_GIT:
        try:
            ok = subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "--quiet", ref],
                                capture_output=True, timeout=15).returncode == 0
        except Exception:
            ok = False
        _CACHE_GIT[ref] = ok
    if not _CACHE_GIT[ref]:
        return None
    try:
        return subprocess.run(["git", "-C", repo, "cat-file", "-e", f"{ref}:{percorso}"],
                              capture_output=True, timeout=15).returncode == 0
    except Exception:
        return None


def righe_di(repo, percorso, ref=None):
    """Righe del file sul ref indicato, o sul checkout corrente se ref è None."""
    if ref is None:
        try:
            with open(os.path.join(repo, percorso), encoding="utf-8", errors="replace") as f:
                return sum(1 for _ in f)
        except Exception:
            return None
    try:
        out = subprocess.run(["git", "-C", repo, "cat-file", "blob", f"{ref}:{percorso}"],
                             capture_output=True, timeout=20)
        return out.stdout.count(b"\n") + (0 if out.stdout.endswith(b"\n") else 1) \
            if out.returncode == 0 else None
    except Exception:
        return None


def _cartella_memorie(repo):
    """
    Le memorie di sessione sono indicizzate per percorso assoluto del progetto. In un
    worktree il percorso è un altro, quindi la cartella non si troverebbe: si risale al
    repo principale con `--git-common-dir`, che in un worktree punta al `.git` d'origine.
    """
    base = os.path.join(os.path.expanduser("~"), ".claude", "projects")
    candidati = [repo]
    try:
        out = subprocess.run(["git", "-C", repo, "rev-parse", "--path-format=absolute",
                              "--git-common-dir"], capture_output=True, text=True, timeout=15)
        if out.returncode == 0 and out.stdout.strip():
            principale = os.path.dirname(out.stdout.strip().rstrip("/"))
            if principale and principale != repo:
                candidati.append(principale)
    except Exception:
        pass
    # Una cartella madre senza git che dichiara questa wiki con `.wiki-llm-path` è dove si
    # aprono le sessioni, quindi è lì che finiscono le memorie (linkdin-auto-post, 2026-09-29).
    madre = os.path.dirname(repo.rstrip("/"))
    if os.path.isfile(os.path.join(madre, ".wiki-llm-path")):
        candidati.append(madre)
    # L'harness non sostituisce solo le barre: anche gli UNDERSCORE diventano trattini.
    # `~/projects/tiacca_dashboard` → `-home-manolocinti-projects-tiacca-dashboard`. Guardando
    # la sola barra, il controllo 9 non trovava la cartella in nessun repo con un underscore
    # nel nome, e si spegneva da solo mostrando un avviso innocuo: «cartella non trovata,
    # controllo saltato». (Revisione avversariale su tiacca_dashboard, 2026-09-09.)
    def slug(percorso):
        return percorso.replace("/", "-").replace("_", "-")

    for c in candidati:
        for nome in (slug(c), c.replace("/", "-")):     # il secondo per i percorsi già senza _
            p = os.path.join(base, nome, "memory")
            if os.path.isdir(p):
                return p
    return os.path.join(base, slug(candidati[0]), "memory")


def controllo_10_rami(w, r):
    def git(*a):
        try:
            out = subprocess.run(["git", "-C", w.repo] + list(a),
                                 capture_output=True, text=True, timeout=30)
            return out.stdout if out.returncode == 0 else None
        except Exception:
            return None

    if git("rev-parse", "--is-inside-work-tree") is None:
        r.avv(10, "-", "non è un repo git: controllo saltato")
        return []
    ramo = (git("rev-parse", "--abbrev-ref", "HEAD") or "?").strip()
    esito = []
    for ref in RAMI_DI_RIFERIMENTO:
        if git("rev-parse", "--verify", "--quiet", ref) is None:
            esito.append({"ref": ref, "stato": "assente"})
            continue
        # Il ramo locale omonimo del ref (`main` contro `origin/main`) non si salta: in un
        # repo con un solo ambiente è l'unico confronto possibile, e ciò che misura — la
        # memoria scritta ma non ancora spinta — è proprio ciò che chi legge da origin non vede.
        omonimo = ref.split("/")[-1] == ramo
        # Un ref che non ha `ROUTER.md` non ha (ancora) questa wiki: il diff conterebbe
        # come «divergenza» l'intera memoria, e il router — l'unica riga iniettata a ogni
        # sessione — annuncerebbe centinaia di file di scarto che nessuno ha prodotto.
        # Finché la wiki non è spinta lì, la misura non è definita: si dichiara, non si
        # inventa. Un numero falso nella riga che si legge sempre è peggio di nessun numero.
        if git("cat-file", "-e", f"{ref}:wiki.llm/ROUTER.md") is None:
            esito.append({"ref": ref, "stato": "non ancora su origin"})
            r.avv(10, f"wiki.llm vs {ref}",
                  "il ref non ha `wiki.llm/ROUTER.md`: questa wiki non è ancora spinta lì, "
                  "quindi la divergenza **non è misurabile** e non viene inventata. "
                  "Torna a essere una misura vera al primo push")
            continue
        # `git diff <ref>` non vede i file mai committati: una pagina nuova non
        # committata non comparirebbe nella divergenza, che è proprio il caso in cui
        # serve saperlo. `--no-index` non aiuta, quindi si contano a parte.
        # `ROUTER.md` è escluso: lo scrive il lint, e la sua riga di stato contiene la
        # misura della divergenza stessa — quindi differirebbe sempre, e «divergenza zero»
        # non sarebbe mai raggiungibile. Si misura la memoria, non il termometro.
        st = git("diff", "--numstat", ref, "--", "wiki.llm", ":(exclude)wiki.llm/ROUTER.md")
        nuovi = git("ls-files", "--others", "--exclude-standard", "--", "wiki.llm") or ""
        n_nuovi = len([x for x in nuovi.splitlines() if x.strip()])
        if st is None:
            esito.append({"ref": ref, "stato": "non confrontabile"})
            continue
        file_n, righe = 0, 0
        for riga in st.splitlines():
            parti = riga.split("\t")
            if len(parti) == 3:
                file_n += 1
                for x in parti[:2]:
                    righe += int(x) if x.isdigit() else 0
        file_n += n_nuovi
        esito.append({"ref": ref, "file": file_n, "righe": righe, "mai_committati": n_nuovi})
        if file_n and omonimo:
            r.avv(10, f"wiki.llm vs {ref}",
                  f"{file_n} file e {righe} righe di memoria non ancora spinte su «{ref}»: "
                  "chi legge da lì non le vede")
        elif file_n:
            r.avv(10, f"wiki.llm vs {ref}",
                  f"{file_n} file e {righe} righe di scarto **nella memoria** (non nel "
                  f"codice, che diverge per scelta): chi legge da «{ref}» non vede questo. "
                  "La wiki è una sola e descrive entrambi gli ambienti — la differenza fra i "
                  "rami si dichiara nel campo `ambiente:`, non tenendo due wiki")
    return esito


# ------------------------------------------------------- scrittura zone AUTO


def zona_auto(testo, nome, contenuto):
    apri, chiudi = f"<!-- AUTO:{nome} -->", f"<!-- /AUTO:{nome} -->"
    i, j = testo.find(apri), testo.find(chiudi)
    if i == -1 or j == -1 or j < i:
        return testo, False
    return testo[:i + len(apri)] + "\n" + contenuto.rstrip() + "\n" + testo[j:], True


def tabella(w, gruppo, intestazione):
    righe = [f"| {intestazione} | quando aprirlo | pag | ver |", "|---|---|--:|--:|"]
    for nome, m in sorted(w.mappe.items()):
        if m["gruppo"] != gruppo or m["fm"] is None:
            continue
        n = sum(1 for p in w.pagine.values() if p["cartella"] == nome)
        righe.append(f"| `{nome}` | {m['fm'].get('router','')} | {n} | {m['fm'].get('verificato_il','?')} |")
    return "\n".join(righe)


def conta_log(radice):
    """
    Quante volte la memoria è stata interrogata, scritta, e quante volte NON aveva la
    risposta. L'ultima è la misura più onesta che questa wiki produce: dice dove è vuota
    davvero, e senza di essa «se la wiki non copre, dillo» resta un buon proposito che
    nessuno può verificare.
    """
    p = os.path.join(radice, "log.md")
    if not os.path.isfile(p):
        return {}
    conta = {"query": 0, "ingest": 0, "buco": 0}
    for riga in leggi(p).splitlines():
        # Con o senza il trattino di elenco: SCHEMA.md detta `AAAA-MM-GG forma — …`, e i log
        # più vecchi (o quelli generati dall'hook) premettono `- `. Contano entrambi.
        m = re.match(r"^(?:-\s+)?\d{4}-\d{2}-\d{2}\s+(\w+)", riga)
        if m and m.group(1) in conta:
            conta[m.group(1)] += 1
    return conta


def scrivi_router(w, r, div, oggi):
    path = os.path.join(w.radice, "ROUTER.md")
    if not os.path.isfile(path):
        return False
    testo = leggi(path)
    scritto = False
    for nome, cont in (("domini", tabella(w, "domini", "dominio")),
                       ("trasversali", tabella(w, "trasversali", "trasversale"))):
        testo, ok = zona_auto(testo, nome, cont)
        scritto = scritto or ok

    n_pag = len(w.pagine)
    n_arc = len(w.archivio)
    scadute = sum(1 for v in r.voci if v["controllo"] == 4)
    daver = sum(1 for v in r.voci if v["controllo"] == 0 and "da-verificare" in v["msg"])
    def divergenza(d):
        # `stato` è il caso in cui la misura non esiste (ref assente, non confrontabile,
        # wiki non ancora spinta): va detto a parole. Scriverlo come «? file/? righe» lo
        # travestiva da misura fallita invece che da misura non applicabile.
        nome = d["ref"].split("/")[-1]
        return f"{nome}: {d['stato']}" if "stato" in d else f"{nome}: {d['file']} file/{d['righe']} righe"

    div_txt = " · ".join(divergenza(d) for d in div) or "non misurata"
    n_mappe = sum(1 for m in w.mappe.values() if m["fm"] is not None)
    log = conta_log(w.radice)
    log_txt = (f" · log: {log.get('query', 0)} query, {log.get('ingest', 0)} ingest, "
               f"**{log.get('buco', 0)} buchi**" if log else "")
    stato = (f"{n_pag} pagine · {n_mappe} mappe · {n_arc} in archivio · "
             f"{daver} campi `da-verificare` · {scadute} verifiche scadute · "
             f"divergenza {div_txt}{log_txt} · lint {oggi} "
             f"({len(r.errori)} errori, {len(r.avvisi)} avvisi)")
    testo, ok = zona_auto(testo, "stato", stato)
    scritto = scritto or ok
    if scritto and testo != leggi(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(testo)
    return scritto


# ------------------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser(description="Controlli deterministici sulla wiki.llm v2")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-write", action="store_true", help="non riscrivere le zone AUTO di ROUTER.md")
    ap.add_argument("--quiet", action="store_true", help="stampa solo se c'è qualcosa da dire")
    ap.add_argument("--wiki", default=None, help="percorso di wiki.llm (default: cartella di questo file)")
    ap.add_argument("--memorie", default=None, help="cartella delle memorie di sessione")
    ap.add_argument("--oggi", default=None, help="YYYY-MM-DD, per test riproducibili")
    args = ap.parse_args()

    radice = os.path.abspath(args.wiki or os.path.dirname(os.path.abspath(__file__)))
    if not os.path.isdir(os.path.join(radice, "domini")):
        eprint(f"lint: `{radice}` non sembra una wiki.llm v2 (manca `domini/`)")
        return 2

    if args.oggi and come_data(args.oggi) is None:
        eprint(f"lint: `--oggi {args.oggi}` non è una data YYYY-MM-DD")
        return 2
    oggi = come_data(args.oggi) or datetime.date.today()

    memorie = args.memorie
    if memorie is None:
        memorie = _cartella_memorie(os.path.dirname(radice))

    w = Wiki(radice)
    r = Referto()

    controllo_0_struttura(w, r)
    controllo_2_tetti(w, r)
    controllo_3_fonti(w, r)
    controllo_4_scadenze(w, r, oggi)
    controllo_5_orfane(w, r)
    controllo_6_link(w, r)
    controllo_7_mappa_vs_disco(w, r)
    controllo_8_segreti(w, r)
    coppie = controllo_9_temi_doppi(w, r, memorie)
    div = controllo_10_rami(w, r)

    # Il router si misura DOPO averlo riscritto: le zone AUTO cambiano la sua dimensione,
    # e prima di questa correzione il lint stampava il peso del file com'era *prima* della
    # propria scrittura — cioè poteva dire «0 errori» e lasciare sul disco un router oltre
    # il tetto, che la sessione dopo avrebbe ricevuto troncato.
    if not args.no_write:
        scrivi_router(w, r, div, oggi)
    byte_router = controllo_1_router(w, r)

    # ...ma il suo avviso nasce così DOPO il timbro, e il timbro contiene il numero degli
    # avvisi: la riga letta a ogni sessione ne dichiarava sistematicamente uno in meno di
    # quelli veri, proprio quando il router è vicino al tetto — cioè quando quel numero
    # conta. Si ritimbra una volta sola: la seconda scrittura tocca solo le cifre dentro la
    # zona AUTO (al più un paio di byte, contro i 307 di margine dell'avviso al 90%), mai
    # la struttura, quindi `byte_router` resta valido e il risultato è stabile al secondo giro.
    if not args.no_write:
        scrivi_router(w, r, div, oggi)

    riepilogo = {
        "oggi": str(oggi),
        "wiki": radice,
        "pagine": len(w.pagine),
        "mappe": sum(1 for m in w.mappe.values() if m["fm"] is not None),
        "archivio": len(w.archivio),
        "parole_pagine": sum(p["parole"] for p in w.pagine.values()),
        "router_byte": byte_router,
        "errori": len(r.errori),
        "avvisi": len(r.avvisi),
        "divergenza_rami": div,
        "coppie_wiki_memorie": len(coppie),
        # Lo SCHEMA §1 dice che per trovare le pagine di un solo ambiente «si filtra il
        # frontmatter — `lint.py --json` espone i campi». Prima non era vero.
        "pagine_dettaglio": [
            {"slug": s, "file": v["rel"], "dominio": v["cartella"], "parole": v["parole"],
             **{k: v["fm"].get(k) for k in
                ("tipo", "stato", "ambiente", "tenant", "stack",
                 "aggiornato_il", "verificato_il", "supersede")}}
            for s, v in sorted(w.pagine.items()) if v["fm"]
        ],
        "voci": r.voci,
    }

    if args.json:
        print(json.dumps(riepilogo, ensure_ascii=False, indent=2))
        return 1 if r.errori else 0

    if args.quiet and not r.voci:
        return 0

    print(f"lint wiki.llm — {riepilogo['pagine']} pagine, {riepilogo['mappe']} mappe, "
          f"{riepilogo['archivio']} in archivio, ROUTER {byte_router} byte "
          f"(tetto {TETTO_ROUTER_BYTE})")
    for livello in ("ERRORE", "AVVISO"):
        voci = [v for v in r.voci if v["livello"] == livello]
        if not voci:
            continue
        etichetta = "ERRORI" if livello == "ERRORE" else "AVVISI"
        print(f"\n{'='*72}\n{etichetta} ({len(voci)})")
        per_controllo = {}
        for v in voci:
            per_controllo.setdefault(v["controllo"], []).append(v)
        for cid in sorted(per_controllo):
            print(f"\n  [{cid}] {NOMI_CONTROLLI.get(cid, '?')}")
            for v in per_controllo[cid]:
                print(f"    {v['dove']}\n      {v['msg']}")
    print(f"\n{'='*72}")
    print(f"{len(r.errori)} errori, {len(r.avvisi)} avvisi")
    return 1 if r.errori else 0


if __name__ == "__main__":
    sys.exit(main())
