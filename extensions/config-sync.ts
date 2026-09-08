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
	ui: { notify(message: string): void };
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
	if (behind > 0 && ctx.hasUI) {
		ctx.ui.notify(
			`Il repo del setup omp è indietro di ${behind} commit. \`git pull\` in ${repo}.`,
		);
	}

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
	if (changed.length === 0) return;

	pi.logger.info(`config-sync: deriva su ${changed.join(", ")}`);
	if (!ctx.hasUI) return;
	ctx.ui.notify(
		`Setup omp diverso dal repo (${changed.join(", ")}). Usa /skill:setup-omp per allineare in una direzione o nell'altra.`,
	);
}
