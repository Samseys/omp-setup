#!/usr/bin/env node
/**
 * Aggancia questo clone a omp: installa la skill `setup-omp` e l'avviso di
 * deriva all'avvio, e registra il percorso del clone nel marcatore che
 * entrambi leggono. Non attiva nessuna sincronizzazione automatica.
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

// `omp config path` stampa la cartella di configurazione, non un file.
const agentDir = execFileSync(OMP, ["config", "path"], { encoding: "utf8" })
	.trim()
	.split(/\r?\n/)
	.pop();

const extension = join(agentDir, "extensions", "config-sync.ts");
const skill = join(agentDir, "skills", "setup-omp", "SKILL.md");
const marker = join(agentDir, "config-sync.json");

if (process.argv.includes("--uninstall")) {
	for (const path of [extension, skill, marker]) rmSync(path, { force: true });
	rmSync(dirname(skill), { force: true, recursive: true });
	console.log("setup-omp rimosso. Riapri omp.");
	process.exit(0);
}

for (const [from, to] of [
	[join(ROOT, "extensions", "config-sync.ts"), extension],
	[join(ROOT, "skills", "setup-omp", "SKILL.md"), skill],
]) {
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
	console.log(`installato: ${to}`);
}

writeFileSync(marker, `${JSON.stringify({ repo: ROOT }, null, 2)}\n`);
console.log(`clone registrato: ${ROOT}`);
console.log("Riapri omp: skill ed estensioni si caricano all'avvio.");
