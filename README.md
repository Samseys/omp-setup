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
| `extensions/installed-stub.ts` | l'unico file copiato fuori dal clone: importa e chiama il precedente |
| `scripts/sync.mjs` | `check` / `apply` / `capture` |
| `scripts/install.mjs` | registra il clone: cartella delle skill + stub dell'estensione |

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

`extensions/config-sync.ts` gira a ogni `session_start`, non scrive niente e non fa rete: confronta e avvisa. L'avviso è una voce nella status line (`⚠ setup omp ▏ 5 impostazioni da allineare ▏ /skill:setup-omp`), che resta finché la sessione è aperta: un `notify` arriva mentre lo schermo si sta ancora componendo e poi passa. Dice quante voci e di che tipo, non quali: i nomi delle chiavi occupano la larghezza senza spiegare niente, e l'elenco lo mostra la skill. Niente colore, la status line strippa le sequenze ANSI. `/skill:setup-omp` (installata a scope user, quindi disponibile in ogni cartella) fa `git pull`, riassume la deriva e chiede la direzione.

Il controllo rigira anche a sessione aperta: le impostazioni si cambiano da `/settings` o con `omp config set` in un altro terminale, e fra gli eventi degli hook non ce n'è uno per la configurazione, quindi la sorgente da guardare è il file. Sono guardati i tre file che il repo sincronizza — `config.yml`, `mcp.json`, `APPEND_SYSTEM.md` — e non la cartella dell'agente: lì stanno `agent.db`, `history.db` e `models.db` coi loro `-wal`, riscritti in continuazione (67 eventi in 30 s di una sessione breve, misurati), quindi il controllo girerebbe senza sosta. Un evento fa scattare un confronto del contenuto prima di spendere lo spawn di `omp config list`, perché omp ritocca `mcp.json` e `APPEND_SYSTEM.md` all'avvio senza cambiarli. A riposo il costo è zero.

Il confronto non guarda solo le chiavi presenti in `agent-config.json`: una modifica da `/settings` tocca quasi sempre una chiave che il repo non ha ancora, quindi guardando solo quelle la deriva più comune sarebbe invisibile. Il `check` elenca anche le chiavi scritte nel `config.yml` locale che sono fuori default e assenti dal repo, così non c'è niente da registrare a mano. Su quelle `apply` fa `omp config reset` — la sua direzione è repo → macchina — e `capture --all` è il verso opposto.

Dopo un `apply` la riga diventa `✔ setup omp ▏ allineato` invece di sparire: `setStatus(key, "")` non toglie la voce dalla riga. La conferma è mostrata solo a chi aveva visto l'avviso, altrimenti sarebbe rumore fisso su ogni sessione.

## Aggiornare

`git pull` basta: script, skill ed estensione girano dal clone. `install.mjs` non copia niente eccetto lo stub — punta `skills.customDirectories` su `<clone>/skills` e scrive il percorso del clone in `~/.omp/agent/config-sync.json`. Va rilanciato solo se il clone cambia posizione, o dopo una modifica a `installed-stub.ts`.

Lo stub esiste perché omp consegna gli eventi di sessione solo agli hook trovati nelle cartelle di discovery (`<agent-dir>/extensions`, `<cwd>/.omp/extensions`): un percorso dichiarato nell'impostazione `extensions` viene caricato, ma i suoi `pi.on(...)` non ricevono niente. Copiato in `~/.omp/agent/extensions/`, legge il marcatore e importa `extensions/config-sync.ts` dal clone.

`node scripts/install.mjs --uninstall` rimuove stub, marcatore e cartella delle skill dalle impostazioni.

## `capture` esclude i default

`omp config list` elenca 486 chiavi comprese quelle mai toccate, quindi non basta a sapere cosa è stato scelto. `capture --all` incrocia due sorgenti: i **percorsi** delle chiavi da `config.yml` (solo quelle davvero scritte), i **valori di fabbrica** da un `omp config list` lanciato su una cartella di configurazione vuota e temporanea (`PI_CODING_AGENT_DIR`). Quel che coincide col default non entra nel repo: non cambierebbe niente altrove e invecchia a ogni aggiornamento di omp.

Esclusi anche percorsi e stato locali (`SKIP_KEYS`) e le chiavi che finiscono in `secret|password|credential|key|token` — solo l'ultimo segmento e al singolare, così `compaction.thresholdTokens` non passa per una credenziale.

## Note

- Stringhe ed enum si passano grezzi a `omp config set`. `omp config set theme.dark '"titanium"'` non dà errore: memorizza la stringa *con* le virgolette. Numeri, booleani, liste e oggetti vanno in JSON.
- `omp config path` stampa la cartella (`~/.omp/agent`), non il file.
- Il check usa un solo `config list` invece di una `config get` per chiave: gira a ogni avvio di sessione e ogni spawn del binario costa ~0,5 s.
- `installed_plugins.json` non è versionabile (contiene percorsi assoluti di cache): si versiona la lista degli id e `apply` reinstalla i mancanti con `omp plugin install --scope user`.
