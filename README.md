# Setup omp

Il mio setup di [omp](https://github.com/can1357/oh-my-pi) versionato, per riprodurlo su un'altra macchina e tenerlo allineato con `git pull`.

Non è una copia di `~/.omp/agent/config.yml`: quel file contiene anche percorsi e stato locali (`shellPath`, `setupVersion`, …). Qui sta solo la parte che ha senso portarsi in giro, e viene riapplicata con `omp config set`, così omp valida i valori e le chiavi locali restano intatte.

| File | Cosa contiene |
|---|---|
| `agent-config.json` | le impostazioni che si discostano dai default (modelli, compaction, tool, UI, …) |
| `mcp-subset.json` | le chiavi di `mcp.json` condivisibili (oggi i server disattivati) |
| `append-system.md` | il contesto appeso al system prompt di ogni sessione (`~/.omp/agent/APPEND_SYSTEM.md`) |
| `plugins.json` | marketplace registrati + plugin installati a livello utente |
| `skills/setup-omp/SKILL.md` | la skill `/skill:setup-omp`, il modo comodo di allineare |
| `extensions/config-sync.ts` | avviso a inizio sessione quando la macchina si discosta dal repo |
| `scripts/sync.mjs` | il motore: `check` / `apply` / `capture` |
| `scripts/install.mjs` | aggancia il clone a omp (skill + avviso + percorso del clone) |

## Su una macchina nuova

```sh
git clone https://github.com/Samseys/omp-setup.git && cd omp-setup
node scripts/sync.mjs apply     # allinea impostazioni, mcp, contesto, plugin
node scripts/install.mjs        # skill + avviso di deriva
```

Poi riapri omp: impostazioni, provider, plugin, skill ed estensioni si leggono all'avvio.

## Uso quotidiano

Niente si applica da sé: **la direzione la decido io**. Non esiste un criterio onesto per dedurla — una chiave diversa non dice se l'ho cambiata qui di proposito o se è rimasta indietro rispetto a un'altra macchina, e indovinare significa o perdere una modifica appena fatta o propagare una prova.

Automatico è invece **accorgersene**: `extensions/config-sync.ts` gira a ogni `session_start`, non scrive niente e non fa rete, e avvisa se la macchina si è discostata dal repo. Da lì basta:

```
/skill:setup-omp
```

La skill è installata a livello utente, quindi risponde in qualunque cartella: legge la deriva, la riassume e chiede da che parte tirare.

```sh
node scripts/sync.mjs                 # cosa differisce (esce 1 se c'è deriva)
node scripts/sync.mjs apply           # repo → macchina
node scripts/sync.mjs capture --all   # macchina → repo, poi commit e push
```

`node scripts/install.mjs --uninstall` toglie skill, avviso e marcatore.

## `capture` esclude i default

`omp config list` elenca 486 chiavi contando anche quelle mai toccate, quindi non basta a sapere cosa ho scelto io. `capture --all` incrocia due sorgenti: i **percorsi** delle chiavi li legge da `config.yml` (solo quelle davvero scritte), i **valori di fabbrica** li ottiene lanciando `omp config list` su una cartella di configurazione vuota e usa e getta (`PI_CODING_AGENT_DIR`). Quello che coincide col default non entra nel repo: su un'altra macchina non cambierebbe niente e invecchierebbe a ogni aggiornamento di omp.

Restano fuori per scelta i percorsi/stato locali (`SKIP_KEYS`) e le chiavi che finiscono in `secret|password|credential|key|token` — l'ultimo segmento e al singolare, così `compaction.thresholdTokens` non viene scambiato per una credenziale.

## Trappole già pagate

- **Stringhe ed enum si passano grezzi a `omp config set`.** `omp config set theme.dark '"titanium"'` non è un errore: memorizza la stringa *con* le virgolette, e la chiave resta rotta in silenzio. Numeri, booleani, liste e oggetti invece vanno in JSON.
- **`omp config path` stampa la cartella, non il file** (`~/.omp/agent`).
- **Il drift check fa un solo `config list`**, non una `config get` per chiave: gira a ogni avvio di sessione e ogni spawn del binario costa mezzo secondo.
- **`installed_plugins.json` non è versionabile** (registra i percorsi assoluti della cache): si versiona la lista degli id, e `apply` reinstalla quelli mancanti con `omp plugin install --scope user`.
