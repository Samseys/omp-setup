# Setup omp

Configurazione di [omp](https://github.com/can1357/oh-my-pi) versionata, per riprodurla su un'altra macchina.

Non è una copia di `~/.omp/agent/config.yml` (che contiene anche percorsi e stato locali: `shellPath`, `setupVersion`, …). I valori vengono riapplicati con `omp config set`, quindi omp li valida e le chiavi non elencate restano intatte.

| File | Contenuto |
|---|---|
| `agent-config.json` | impostazioni diverse dai default (modelli, compaction, tool, UI, …) |
| `mcp-subset.json` | chiavi condivisibili di `mcp.json` (per ora `disabledServers`) |
| `append-system.md` | contesto appeso al system prompt (`~/.omp/agent/APPEND_SYSTEM.md`) |
| `plugins.json` | marketplace registrati + plugin a scope user |
| `skills/setup-omp/SKILL.md` | skill `/skill:setup-omp` |
| `extensions/config-sync.ts` | avviso a inizio sessione se la macchina è fuori sync |
| `scripts/sync.mjs` | `check` / `apply` / `capture` |
| `scripts/install.mjs` | installa skill + estensione, registra il percorso del clone |

## Macchina nuova

```sh
git clone https://github.com/Samseys/omp-setup.git && cd omp-setup
node scripts/sync.mjs apply     # impostazioni, mcp, contesto, plugin
node scripts/install.mjs        # skill + avviso
```

Riaprire omp: impostazioni, provider, plugin, skill ed estensioni si leggono all'avvio.

## Uso

```sh
node scripts/sync.mjs                 # cosa differisce (exit 1 se c'è deriva)
node scripts/sync.mjs apply           # repo → macchina
node scripts/sync.mjs capture --all   # macchina → repo, poi commit e push
```

Nessuna delle due direzioni è automatica: una chiave diversa non dice se è stata cambiata qui di proposito o se è rimasta indietro rispetto a un'altra macchina.

`extensions/config-sync.ts` gira a ogni `session_start`, non scrive niente e non fa rete: confronta e avvisa. `/skill:setup-omp` (installata a scope user, quindi disponibile in ogni cartella) fa `git pull`, riassume la deriva e chiede la direzione.

`node scripts/install.mjs --uninstall` rimuove skill, estensione e marcatore. Skill ed estensione sono installate per copia: dopo averle modificate, rilanciare `install.mjs`.

## `capture` esclude i default

`omp config list` elenca 486 chiavi comprese quelle mai toccate, quindi non basta a sapere cosa è stato scelto. `capture --all` incrocia due sorgenti: i **percorsi** delle chiavi da `config.yml` (solo quelle davvero scritte), i **valori di fabbrica** da un `omp config list` lanciato su una cartella di configurazione vuota e temporanea (`PI_CODING_AGENT_DIR`). Quel che coincide col default non entra nel repo: non cambierebbe niente altrove e invecchia a ogni aggiornamento di omp.

Esclusi anche percorsi e stato locali (`SKIP_KEYS`) e le chiavi che finiscono in `secret|password|credential|key|token` — solo l'ultimo segmento e al singolare, così `compaction.thresholdTokens` non passa per una credenziale.

## Note

- Stringhe ed enum si passano grezzi a `omp config set`. `omp config set theme.dark '"titanium"'` non dà errore: memorizza la stringa *con* le virgolette. Numeri, booleani, liste e oggetti vanno in JSON.
- `omp config path` stampa la cartella (`~/.omp/agent`), non il file.
- Il check usa un solo `config list` invece di una `config get` per chiave: gira a ogni avvio di sessione e ogni spawn del binario costa ~0,5 s.
- `installed_plugins.json` non è versionabile (contiene percorsi assoluti di cache): si versiona la lista degli id e `apply` reinstalla i mancanti con `omp plugin install --scope user`.
