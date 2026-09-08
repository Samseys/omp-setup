/**
 * Segnala all'avvio della sessione se il setup omp di questa macchina si è
 * discostato dal repo. Non tocca niente e non fa rete: la deriva è
 * un'informazione, la direzione in cui risolverla la decide chi legge.
 *
 * Girata da `extensions/installed-stub.ts`, l'unico file copiato in
 * `~/.omp/agent/extensions/`.
 */
import { readFileSync, watch } from "node:fs";
import { join } from "node:path";

type ExecResult = { code: number; stdout?: string; stderr?: string };

type HookContext = {
	hasUI: boolean;
	ui: { setStatus(key: string, text: string): void };
};

type HookAPI = {
	cwd: string;
	logger: { info(message: string): void; warn(message: string): void };
	exec(
		file: string,
		args: string[],
		opts?: { cwd?: string },
	): Promise<ExecResult>;
	on(
		event: "session_start",
		handler: (event: unknown, ctx: HookContext) => Promise<void>,
	): void;
};

/**
 * Quanti commit ha `origin` in più del clone, dai ref già scaricati: nessuna
 * chiamata di rete. Un `git fetch` qui resta appeso se git chiede le
 * credenziali, e l'hook non finirebbe mai — i ref li aggiorna il `git pull`
 * della skill.
 */
async function countBehind(pi: HookAPI, repo: string): Promise<number> {
	const res = await pi.exec("git", ["rev-list", "--count", "HEAD..@{upstream}"], {
		cwd: repo,
	});
	// Nessun upstream o clone assente: niente da dire.
	return res.code === 0 ? Number((res.stdout ?? "").trim()) || 0 : 0;
}

/**
 * Chiamata dallo stub installato in `<agent-dir>/extensions`, che è anche
 * l'unico a sapere dov'è il clone: qui `import.meta` punterebbe al clone
 * stesso, non alla cartella dell'agente dove sta il marcatore.
 */
export async function onSessionStart(
	pi: HookAPI,
	ctx: HookContext,
	repo: string,
	agentDir: string,
): Promise<void> {
	// Skill, estensione e script girano dal clone: se è indietro, questa
	// macchina sta usando la versione vecchia di tutti e tre. Si legge una volta:
	// il conteggio cambia solo con un `git pull`.
	const behind = await countBehind(pi, repo);
	await refresh(pi, ctx, repo, behind);
	if (ctx.hasUI) watchConfig(pi, ctx, repo, behind, agentDir);
}

/** Vero da quando l'avviso è comparso: vale per questa sessione. */
let warned = false;

/** I file che il repo sincronizza, gli unici che vale la pena guardare. */
const WATCHED = ["config.yml", "mcp.json", "APPEND_SYSTEM.md"];

/** Contenuto dei file guardati: pochi KB, e distingue una modifica da un tocco. */
function snapshot(agentDir: string): string {
	return WATCHED.map(name => {
		try {
			return readFileSync(join(agentDir, name), "utf8");
		} catch {
			return "";
		}
	}).join("\u0000");
}

/**
 * Le impostazioni si cambiano a sessione aperta — da `/settings` o con
 * `omp config set` in un altro terminale — e fra gli eventi degli hook non ce
 * n'è uno per la configurazione: la sorgente da guardare è il file.
 *
 * Un watch sulla *cartella* dell'agente non si può fare: lì stanno `agent.db`,
 * `history.db` e `models.db` coi loro `-wal`, riscritti in continuazione,
 * quindi il controllo girerebbe a ogni finestra di debounce per tutta la
 * sessione. Guardando i tre file il costo a riposo è zero.
 */
function watchConfig(
	pi: HookAPI,
	ctx: HookContext,
	repo: string,
	behind: number,
	agentDir: string,
): void {
	let timer: NodeJS.Timeout | undefined;
	let running = false;
	let seen = snapshot(agentDir);
	const schedule = (): void => {
		// Un salvataggio produce più eventi e il controllo costa uno spawn di
		// `omp config list`: si aspetta che il file si fermi.
		clearTimeout(timer);
		timer = setTimeout(() => {
			if (running) return;
			// omp ritocca `mcp.json` e `APPEND_SYSTEM.md` all'avvio senza cambiarli:
			// senza questo confronto ogni sessione pagherebbe un controllo in più.
			const now = snapshot(agentDir);
			if (now === seen) return;
			seen = now;
			running = true;
			refresh(pi, ctx, repo, behind)
				.catch((error: unknown) =>
					pi.logger.warn(`config-sync: ${String(error)}`),
				)
				.finally(() => {
					running = false;
				});
		}, 1_500);
	};

	for (const name of WATCHED) {
		try {
			// Il watcher non deve tenere in vita il processo all'uscita.
			watch(join(agentDir, name), schedule).unref();
		} catch {
			// File non ancora scritto (mcp.json, APPEND_SYSTEM.md): niente da guardare.
		}
	}
}

async function refresh(
	pi: HookAPI,
	ctx: HookContext,
	repo: string,
	behind: number,
): Promise<void> {
	const run = await pi.exec("node", [join("scripts", "sync.mjs")], {
		cwd: repo,
	});
	// `check` esce 1 quando trova deriva: è un esito, non un guasto.
	if (run.code !== 0 && run.code !== 1) {
		pi.logger.warn(
			`config-sync: ${`${run.stderr ?? ""}${run.stdout ?? ""}`.trim()}`,
		);
		return;
	}

	const marker = `${run.stdout ?? ""}`
		.split(/\r?\n/)
		.find(line => line.startsWith("DERIVA="));
	const changed = (marker?.slice("DERIVA=".length) ?? "")
		.split(",")
		.filter(Boolean);
	if (changed.length > 0) {
		pi.logger.info(`config-sync: deriva su ${changed.join(", ")}`);
	}
	// Solo status line: un `notify` arriva mentre lo schermo si sta ancora
	// componendo e poi passa, quindi chi cambia un'impostazione non vede niente.
	if (!ctx.hasUI) return;

	if (changed.length > 0 || behind > 0) {
		warned = true;
		ctx.ui.setStatus("config-sync", statusText(changed, behind));
		return;
	}
	// `setStatus(key, "")` non toglie la voce dalla riga, quindi il rientro va
	// dichiarato; ma solo a chi aveva visto l'avviso, o sarebbe rumore fisso.
	if (warned) ctx.ui.setStatus("config-sync", "✔ setup omp ▏ allineato");
}

type Kind = "impostazione" | "mcp" | "marketplace" | "plugin" | "contesto";

/** Ordine di lettura, singolare e plurale di ogni tipo di voce in deriva. */
const KINDS: Array<{ kind: Kind; one: string; many: string }> = [
	{ kind: "impostazione", one: "impostazione", many: "impostazioni" },
	{ kind: "mcp", one: "chiave MCP", many: "chiavi MCP" },
	{ kind: "marketplace", one: "marketplace", many: "marketplace" },
	{ kind: "plugin", one: "plugin", many: "plugin" },
	{ kind: "contesto", one: "contesto di sistema", many: "contesto di sistema" },
];

function kindOf(item: string): Kind {
	if (item.startsWith("mcp.")) return "mcp";
	if (item.startsWith("marketplace ")) return "marketplace";
	if (item.startsWith("plugin ")) return "plugin";
	if (item.startsWith("APPEND_SYSTEM")) return "contesto";
	return "impostazione";
}

/**
 * La status line è larga poche decine di caratteri e va letta di sfuggita:
 * `browser.headless, task.maxConcurrency +3` dice quali chiavi senza dire cosa
 * è successo, e i nomi lunghi mangiano lo spazio prima del suggerimento. Qui si
 * dice quante voci e di che tipo; quali sono le mostra la skill.
 */
function statusText(changed: string[], behind: number): string {
	const counts: Record<Kind, number> = {
		impostazione: 0,
		mcp: 0,
		marketplace: 0,
		plugin: 0,
		contesto: 0,
	};
	for (const item of changed) counts[kindOf(item)] += 1;

	const parts = KINDS.filter(({ kind }) => counts[kind] > 0).map(
		({ kind, one, many }) =>
			`${counts[kind]} ${counts[kind] === 1 ? one : many}`,
	);
	if (behind > 0) parts.push(`⇣ ${behind} commit`);

	// Colore niente: la status line strippa le sequenze ANSI. Restano i glifi, e
	// gli spazi ripetuti li collassa la sanificazione: i separatori sono
	// caratteri veri.
	return `⚠ setup omp ▏ ${parts.join(" · ")} da allineare ▏ /skill:setup-omp`;
}
