/**
 * Segnala all'avvio della sessione se il setup omp di questa macchina si è
 * discostato dal repo. Non tocca niente e non fa rete: la deriva è
 * un'informazione, la direzione in cui risolverla la decide chi legge.
 *
 * Girata da `extensions/installed-stub.ts`, l'unico file copiato in
 * `~/.omp/agent/extensions/`.
 */
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
): Promise<void> {
	// Skill, estensione e script girano dal clone: se è indietro, questa
	// macchina sta usando la versione vecchia di tutti e tre.
	const behind = await countBehind(pi, repo);

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
	if (changed.length === 0 && behind === 0) return;
	if (changed.length > 0) {
		pi.logger.info(`config-sync: deriva su ${changed.join(", ")}`);
	}
	// Solo status line: un `notify` arriva mentre lo schermo si sta ancora
	// componendo e poi passa, quindi chi cambia un'impostazione non vede niente.
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("config-sync", statusText(changed, behind));
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
