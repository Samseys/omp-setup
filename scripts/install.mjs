#!/usr/bin/env node
/**
 * Aggancia questo clone a omp: copia l'estensione in `~/.omp/agent/extensions/`
 * e registra il percorso del clone nel marcatore che l'estensione legge.
 *
 *   node scripts/install.mjs                 # pull+apply automatici, ogni 6 ore
 *   node scripts/install.mjs --check-only    # segnala la deriva, non la applica
 *   node scripts/install.mjs --every=0       # pull a ogni sessione
 *   node scripts/install.mjs --uninstall
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OMP = process.env.OMP_BIN || "omp";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = process.argv.slice(2);

// `omp config path` stampa la cartella di configurazione, non un file.
const agentDir = execFileSync(OMP, ["config", "path"], { encoding: "utf8" })
	.trim()
	.split(/\r?\n/)
	.pop();
const target = join(agentDir, "extensions", "config-sync.ts");
const marker = join(agentDir, "config-sync.json");

if (flags.includes("--uninstall")) {
	for (const path of [target, marker, join(agentDir, "config-sync-stamp")]) {
		rmSync(path, { force: true });
	}
	console.log("config-sync rimosso. Riapri omp.");
	process.exit(0);
}

const every = flags.find(flag => flag.startsWith("--every="));

mkdirSync(dirname(target), { recursive: true });
copyFileSync(join(ROOT, "extensions", "config-sync.ts"), target);
writeFileSync(
	marker,
	`${JSON.stringify(
		{
			repo: ROOT,
			pullEveryHours: every ? Number(every.split("=")[1]) : 6,
			autoApply: !flags.includes("--check-only"),
		},
		null,
		2,
	)}\n`,
);

console.log(`Estensione installata in ${target}`);
console.log(`Clone registrato: ${ROOT}`);
console.log("Riapri omp: le estensioni si caricano all'avvio.");
