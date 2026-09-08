# Setup omp

Il mio setup di [omp](https://github.com/can1357/oh-my-pi) versionato, per riprodurlo su un'altra macchina e tenerlo allineato con `git pull`.

Non è una copia di `~/.omp/agent/config.yml`: quel file contiene anche percorsi e stato locali (`shellPath`, `setupVersion`, …). Qui sta solo la parte che ha senso portarsi in giro, e viene riapplicata con `omp config set`, così omp valida i valori e le chiavi locali restano intatte.

| File | Cosa contiene |
|---|---|
| `agent-config.json` | le impostazioni che si discostano dai default (modelli, compaction, tool, UI, …) |
| `mcp-subset.json` | le chiavi di `mcp.json` condivisibili (oggi i server disattivati) |
| `append-system.md` | il contesto appeso al system prompt di ogni sessione (`~/.omp/agent/APPEND_SYSTEM.md`) |
| `plugins.json` | marketplace registrati + plugin installati a livello utente |
| `extensions/config-sync.ts` | l'estensione omp che sincronizza da sé a ogni sessione |
| `scripts/sync.mjs` | il motore: `check` / `apply` / `capture` |
| `scripts/install.mjs` | aggancia il clone a omp (copia l'estensione, registra il percorso) |

## Su una macchina nuova

```sh
git clone <questo repo> && cd omp-config
node scripts/sync.mjs apply     # allinea impostazioni, mcp, contesto, plugin
node scripts/install.mjs        # da qui in poi si aggiorna da sé
```

Poi riapri omp: impostazioni, provider, plugin ed estensioni si leggono all'avvio.

## Sincronizzazione automatica

`scripts/install.mjs` copia `extensions/config-sync.ts` in `~/.omp/agent/extensions/` e scrive in `~/.omp/agent/config-sync.json` il percorso del clone. A ogni `session_start`, in qualunque cartella, l'estensione fa `git pull --ff-only` sul clone (non più di una volta ogni 6 ore, `--every=<ore>`, `0` = sempre) e applica la deriva, poi avvisa cosa è cambiato.

Il pull è solo fast-forward: un merge da risolvere non si fa all'avvio di una sessione. Con `--check-only` l'estensione segnala la deriva senza toccare niente; `--uninstall` la rimuove.

**Il repo è la fonte di verità.** Una modifica fatta a mano sulla macchina viene riportata indietro alla prossima sessione, a meno che non la si catturi:

```sh
node scripts/sync.mjs capture --all   # rilegge tutto il setup locale
git commit -am "config: …" && git push
```

## `capture` esclude i default

`omp config list` elenca 486 chiavi contando anche quelle mai toccate, quindi non basta a sapere cosa ho scelto io. `capture --all` incrocia due sorgenti: i **percorsi** delle chiavi li legge da `config.yml` (solo quelle davvero scritte), i **valori di fabbrica** li ottiene lanciando `omp config list` su una cartella di configurazione vuota e usa e getta (`PI_CODING_AGENT_DIR`). Quello che coincide col default non entra nel repo: su un'altra macchina non cambierebbe niente e invecchierebbe a ogni aggiornamento di omp.

Restano fuori per scelta i percorsi/stato locali (`SKIP_KEYS`) e le chiavi che finiscono in `secret|password|credential|key|token` — l'ultimo segmento e al singolare, così `compaction.thresholdTokens` non viene scambiato per una credenziale.

## Trappole già pagate

- **Stringhe ed enum si passano grezzi a `omp config set`.** `omp config set theme.dark '"titanium"'` non è un errore: memorizza la stringa *con* le virgolette, e la chiave resta rotta in silenzio. Numeri, booleani, liste e oggetti invece vanno in JSON.
- **`omp config path` stampa la cartella, non il file** (`~/.omp/agent`).
- **Il drift check fa un solo `config list`**, non una `config get` per chiave: gira a ogni avvio di sessione e ogni spawn del binario costa mezzo secondo.
- **`installed_plugins.json` non è versionabile** (registra i percorsi assoluti della cache): si versiona la lista degli id, e `apply` reinstalla quelli mancanti con `omp plugin install --scope user`.
