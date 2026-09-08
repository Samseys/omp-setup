#!/usr/bin/env node
/**
 * Aggancia questo clone a omp: le skill si caricano dalla cartella del repo
 * (`skills.customDirectories`) e l'estensione da uno stub che importa il
 * codice dal clone. Così `git pull` aggiorna tutto senza reinstallare.
 *
 *   node scripts/install.mjs
 *   node scripts/install.mjs --uninstall
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OMP = process.env.OMP_BIN || "omp";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const uninstall = process.argv.includes("--uninstall");

// `omp config path` stampa la cartella di configurazione, non un file.
const agentDir = execFileSync(OMP, ["config", "path"], { encoding: "utf8" })
	.trim()
	.split(/\r?\n/)
	.pop();
// L'estensione ci legge il percorso del clone.
const marker = join(agentDir, "config-sync.json");

function readList(key) {
	const out = execFileSync(OMP, ["config", "get", key, "--json"], {
		encoding: "utf8",
	});
	return JSON.parse(out).value ?? [];
}

/** Le altre voci sono di chi le ha messe: si tocca solo la propria. */
function setList(key, entry) {
	const kept = readList(key).filter(item => !item.startsWith(ROOT));
	const next = uninstall ? kept : [...kept, entry];
	execFileSync(OMP, ["config", "set", key, JSON.stringify(next)], {
		stdio: "inherit",
	});
}

setList("skills.customDirectories", join(ROOT, "skills"));

// Gli hook girano solo dalle cartelle di discovery: un percorso in
// `extensions:` viene caricato ma non riceve gli eventi di sessione.
const stub = join(agentDir, "extensions", "config-sync.ts");

if (uninstall) {
	rmSync(stub, { force: true });
	rmSync(join(agentDir, "config-sync-fetch"), { force: true });
	rmSync(marker, { force: true });
	console.log("Scollegato. Riapri omp.");
	process.exit(0);
}

mkdirSync(dirname(stub), { recursive: true });
copyFileSync(join(ROOT, "extensions", "installed-stub.ts"), stub);
writeFileSync(marker, `${JSON.stringify({ repo: ROOT }, null, 2)}\n`);
console.log(`Clone collegato: ${ROOT}`);
console.log("Riapri omp: skill ed estensioni si caricano all'avvio.");
