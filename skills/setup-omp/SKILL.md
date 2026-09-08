---
name: setup-omp
description: Allinea il setup omp di questa macchina al repo omp-setup (o viceversa) — impostazioni, mcp.json, contesto di sistema, marketplace e plugin utente. Usala quando l'avviso di deriva compare all'avvio, dopo aver cambiato impostazioni da omp, o su una macchina nuova.
---

# Sincronizzare il setup omp

Il repo del setup è registrato in `~/.omp/agent/config-sync.json` (chiave `repo`); leggilo invece di indovinare il percorso. Tutti i comandi girano **dentro quel repo**.

Niente è automatico, di proposito: la direzione la decide l'utente. Il tuo compito è mostrargli **cosa** differisce e chiedere da che parte tirare, non scegliere per lui.

## 1. Guarda la deriva

```sh
git pull --ff-only          # il repo può essere più avanti di questa macchina
node scripts/sync.mjs       # esce 1 se c'è deriva; elenca chiave per chiave
```

Ogni riga `✘` mostra `locale` e `atteso`. Riassumile in italiano — sono impostazioni, non output da incollare grezzo.

## 2. Scegli la direzione

Chiedi all'utente quale, se non l'ha già detto, riportando le differenze:

- **repo → macchina** (l'ho cambiato su un'altra macchina, o è un'installazione nuova):
  ```sh
  node scripts/sync.mjs apply
  ```
  Poi ricordagli di riaprire omp: impostazioni, provider, plugin ed estensioni si leggono all'avvio.

- **macchina → repo** (ho cambiato le impostazioni qui e le voglio tenere):
  ```sh
  node scripts/sync.mjs capture --all
  git add -A && git commit -m "config: <cosa è cambiato>" && git push
  ```
  `capture --all` rilegge tutto il setup locale e scarta quello che coincide col default. Mostra il `git diff` prima di committare: è il momento in cui si accorge di aver catturato una modifica fatta per prova.

Se le differenze sono di segno misto (una chiave da tenere, un'altra da buttare) non c'è una via di mezzo automatica: allinea a mano quella singola chiave con `omp config set <chiave> <valore>` — stringhe ed enum **grezzi**, il resto in JSON — poi rifai `capture --all`.

## Macchina nuova

```sh
git clone https://github.com/Samseys/omp-setup.git && cd omp-setup
node scripts/sync.mjs apply
node scripts/install.mjs     # installa questa skill + l'avviso di deriva
```

## Cosa copre

`agent-config.json` (impostazioni diverse dai default), `mcp-subset.json` (`disabledServers`), `append-system.md` (`~/.omp/agent/APPEND_SYSTEM.md`), `plugins.json` (marketplace + plugin a scope user). Percorsi e stato locali (`shellPath`, `setupVersion`, chiavi che finiscono in `secret|password|credential|key|token`) restano fuori: vedi `README.md` del repo.
