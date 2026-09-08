#!/usr/bin/env node
/**
 * Porta il setup omp di questo repo su una macchina, e viceversa.
 *
 *   node scripts/sync.mjs                # check (esce 1 se c'è deriva)
 *   node scripts/sync.mjs apply          # allinea la macchina al repo
 *   node scripts/sync.mjs capture        # rilegge dalla macchina le chiavi già elencate
 *   node scripts/sync.mjs capture --all  # rilegge tutto il setup locale
 *
 * Le impostazioni passano da `omp config set` invece che da una riscrittura di
 * config.yml: le chiavi non elencate (percorsi locali compresi) restano
 * intatte e i valori sono validati da omp.
 */
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OMP = process.env.OMP_BIN || "omp";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "agent-config.json");
const MCP_FILE = join(ROOT, "mcp-subset.json");
const PLUGINS_FILE = join(ROOT, "plugins.json");
/** Contesto appeso al system prompt di ogni sessione: file intero, non chiavi. */
const APPEND_FILE = join(ROOT, "append-system.md");
const APPEND_NAME = "APPEND_SYSTEM.md";
/** Chiavi di mcp.json sincronizzate: i server con credenziali negli env restano locali. */
const MCP_KEYS = ["disabledServers"];
/** Stato e percorsi di questa macchina: non hanno senso su un'altra. Le due
 * liste di percorsi le scrive `install.mjs`, che sa dov'è il clone. */
const SKIP_KEYS = [
	"shellPath",
	"setupVersion",
	"dev.autoqaConsent",
	"skills.customDirectories",
	"extensions",
];
// Solo l'ultimo segmento e al singolare: `compaction.thresholdTokens` non è
// una credenziale.
const SECRET_KEY = /(secret|password|credential|key|token)$/i;

const [, , rawAction = "check", ...flags] = process.argv;
const action = rawAction.startsWith("--") ? "check" : rawAction;
const scanAll = flags.includes("--all") || rawAction === "--all";

if (!["check", "apply", "capture"].includes(action)) {
	console.error(`Azione sconosciuta: ${action} (check|apply|capture)`);
	process.exit(2);
}

function ompJson(args, env) {
	const out = execFileSync(OMP, [...args, "--json"], {
		encoding: "utf8",
		env: { ...process.env, ...env },
	});
	return JSON.parse(out);
}

/** Un solo `config list` invece di una `config get` per chiave: il check gira
 * anche all'avvio di ogni sessione e ogni spawn del binario costa mezzo secondo. */
function configValues(env) {
	const listed = ompJson(["config", "list"], env);
	const values = {};
	for (const [key, entry] of Object.entries(listed)) values[key] = entry.value;
	return values;
}

/**
 * I valori di fabbrica: `config list` su una cartella di configurazione vuota e
 * usa e getta. Senza questo confronto la cattura porta dentro anche le chiavi
 * che il wizard ha scritto col default, che su un'altra macchina non cambiano
 * niente e invecchiano male a ogni aggiornamento di omp.
 */
function factoryDefaults() {
	const dir = mkdtempSync(join(tmpdir(), "omp-defaults-"));
	try {
		return configValues({ PI_CODING_AGENT_DIR: dir });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function configDir() {
	// `omp config path` stampa la cartella di configurazione, non un file.
	return execFileSync(OMP, ["config", "path"], { encoding: "utf8" })
		.trim()
		.split(/\r?\n/)
		.pop();
}

/** I fine riga sono quelli della piattaforma: confrontarli farebbe risultare
 * diverso ogni file passato per un clone Windows. */
function readText(path) {
	return existsSync(path) ? readFileSync(path, "utf8").replace(/\r\n/g, "\n") : "";
}

/**
 * Le chiavi davvero impostate sono quelle scritte nel config.yml: `config list`
 * elenca anche tutto il resto. Servono i soli percorsi — i valori li ha già
 * `configValues()`. Alcune impostazioni sono un oggetto intero (`modelRoles`),
 * altre una foglia annidata (`theme.dark`): vale il prefisso più corto che omp
 * riconosce.
 */
function localKeyPaths(known) {
	const lines = readText(join(configDir(), "config.yml"))
		.split("\n")
		.filter(line => line.trim() && !line.trim().startsWith("#"));

	const keys = new Set();
	const stack = [];
	for (const line of lines) {
		const match = /^(\s*)([\w.\-]+):\s*(.*)$/.exec(line);
		if (!match) continue; // voce di lista o continuazione: la copre il padre
		const [, indent, key] = match;
		while (stack.length > 0 && stack.at(-1).indent >= indent.length) stack.pop();
		stack.push({ indent: indent.length, key });

		const path = stack.map(entry => entry.key);
		for (let depth = 1; depth <= path.length; depth++) {
			const candidate = path.slice(0, depth).join(".");
			if (!known.includes(candidate)) continue;
			keys.add(candidate);
			break;
		}
	}
	return [...keys];
}

/** La cartella dei plugin è sorella di quella dell'agente (`~/.omp`). */
function localPlugins() {
	const home = join(configDir(), "..");
	const marketplaces = JSON.parse(
		readText(join(home, "marketplaces.json")) || '{"marketplaces":[]}',
	).marketplaces.map(entry => ({ name: entry.name, source: entry.sourceUri }));

	// Si versiona la lista, non `installed_plugins.json`: quello registra
	// percorsi di cache assoluti.
	const installed = JSON.parse(
		readText(join(home, "plugins", "installed_plugins.json")) || '{"plugins":{}}',
	).plugins;
	const plugins = Object.entries(installed)
		.filter(([, installs]) => installs.some(install => install.scope === "user"))
		.map(([id]) => id);

	return { marketplaces, plugins };
}

const wanted = JSON.parse(readFileSync(FILE, "utf8"));
const local = configValues();
const defaults = factoryDefaults();

/** Locale, impostata a mano e diversa dal default: da confrontare col repo. */
function isTracked(key) {
	if (SKIP_KEYS.includes(key) || SECRET_KEY.test(key.split(".").pop())) return false;
	return JSON.stringify(local[key]) !== JSON.stringify(defaults[key]);
}

if (action === "capture") {
	const keys = scanAll ? localKeyPaths(Object.keys(defaults)) : Object.keys(wanted);
	const captured = {};
	const dropped = [];
	for (const key of keys) {
		if (!isTracked(key)) {
			dropped.push(key);
			continue;
		}
		captured[key] = local[key];
	}
	writeFileSync(FILE, `${JSON.stringify(captured, null, "\t")}\n`);

	const mcp = JSON.parse(readText(join(configDir(), "mcp.json")) || "{}");
	const mcpSubset = {};
	for (const key of MCP_KEYS) mcpSubset[key] = mcp[key];
	writeFileSync(MCP_FILE, `${JSON.stringify(mcpSubset, null, "\t")}\n`);
	writeFileSync(APPEND_FILE, readText(join(configDir(), APPEND_NAME)));
	writeFileSync(PLUGINS_FILE, `${JSON.stringify(localPlugins(), null, "\t")}\n`);

	if (dropped.length > 0) console.log(`Escluse: ${dropped.join(", ")}\n`);
	console.log(
		`${Object.keys(captured).length} chiavi + mcp.json + ${APPEND_NAME} + plugin. Committa e spingi per portarli sulle altre macchine.`,
	);
	process.exit(0);
}

const drift = [];
for (const [key, want] of Object.entries(wanted)) {
	if (JSON.stringify(local[key]) === JSON.stringify(want)) continue;
	drift.push(key);
	console.log(
		`✘ ${key}: locale ${JSON.stringify(local[key])} — atteso ${JSON.stringify(want)}`,
	);
	if (action !== "apply") continue;
	// Stringhe ed enum vanno grezze: `"yolo"` con le virgolette non è un valore
	// valido. Il resto (numeri, booleani, liste, oggetti) lo vuole in JSON.
	const literal = typeof want === "string" ? want : JSON.stringify(want);
	execFileSync(OMP, ["config", "set", key, literal], { stdio: "inherit" });
}

// Il confronto sulle sole chiavi del repo è cieco su quello che si cambia da
// `/settings`: una chiave nuova non è nel repo, quindi non veniva guardata da
// nessuno e la deriva restava invisibile.
for (const key of localKeyPaths(Object.keys(defaults))) {
	if (key in wanted || !isTracked(key)) continue;
	drift.push(key);
	console.log(`✘ ${key}: locale ${JSON.stringify(local[key])} — non nel repo`);
	// `apply` è la direzione repo → macchina: qui vuol dire tornare al default.
	// Per tenerla, `capture --all`.
	if (action === "apply") {
		execFileSync(OMP, ["config", "reset", key], { stdio: "inherit" });
	}
}

const mcpPath = join(configDir(), "mcp.json");
const mcpLocal = JSON.parse(readText(mcpPath) || "{}");
const mcpWanted = JSON.parse(readFileSync(MCP_FILE, "utf8"));
let mcpChanged = false;
for (const [key, want] of Object.entries(mcpWanted)) {
	if (JSON.stringify(mcpLocal[key]) === JSON.stringify(want)) continue;
	drift.push(`mcp.${key}`);
	console.log(
		`✘ mcp.json ${key}: locale ${JSON.stringify(mcpLocal[key])} — atteso ${JSON.stringify(want)}`,
	);
	if (action !== "apply") continue;
	mcpLocal[key] = want;
	mcpChanged = true;
}
// Riscritto per intero perché non c'è un `omp mcp config set`: le altre chiavi
// si preservano rileggendo il file e sostituendo solo quelle sincronizzate.
if (mcpChanged) writeFileSync(mcpPath, `${JSON.stringify(mcpLocal, null, 2)}\n`);

const appendPath = join(configDir(), APPEND_NAME);
if (readText(appendPath) !== readText(APPEND_FILE)) {
	drift.push(APPEND_NAME);
	console.log(`✘ ${APPEND_NAME}: diverso da append-system.md`);
	if (action === "apply") writeFileSync(appendPath, readText(APPEND_FILE));
}

const pluginsWanted = JSON.parse(readFileSync(PLUGINS_FILE, "utf8"));
const pluginsLocal = localPlugins();
for (const entry of pluginsWanted.marketplaces) {
	if (pluginsLocal.marketplaces.some(item => item.source === entry.source)) continue;
	drift.push(`marketplace ${entry.name}`);
	console.log(`✘ marketplace mancante: ${entry.name} (${entry.source})`);
	if (action !== "apply") continue;
	execFileSync(OMP, ["plugin", "marketplace", "add", entry.source], {
		stdio: "inherit",
	});
}
for (const id of pluginsWanted.plugins) {
	if (pluginsLocal.plugins.includes(id)) continue;
	drift.push(`plugin ${id}`);
	console.log(`✘ plugin mancante: ${id}`);
	if (action !== "apply") continue;
	execFileSync(OMP, ["plugin", "install", "--scope", "user", id], {
		stdio: "inherit",
	});
}

if (drift.length === 0) {
	console.log(
		`Configurazione allineata (${Object.keys(wanted).length} chiavi + mcp.json + ${APPEND_NAME} + plugin).`,
	);
	process.exit(0);
}

if (action === "apply") {
	// Provider, estensioni, plugin e tool si leggono all'avvio: non in questa sessione.
	console.log(`\nApplicate ${drift.length} voci. Riapri omp per vederle attive.`);
	process.exit(0);
}

console.log(`\n${drift.length} voci da allineare: node scripts/sync.mjs apply`);
// Riga per l'estensione: leggere le righe decorate significherebbe accordarsi
// su un glifo e su una lingua.
console.log(`DERIVA=${drift.join(",")}`);
process.exit(1);
