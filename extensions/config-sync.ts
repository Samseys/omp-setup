/**
 * Tiene allineato il setup omp di questa macchina a quello del repo: a ogni
 * sessione fa `git pull` e applica la deriva. Senza, la sincronizzazione
 * esiste ma va ricordata — cioè non avviene, e le macchine divergono in
 * silenzio finché una skill si comporta in modo diverso.
 *
 * Installato in `~/.omp/agent/extensions/` da `scripts/install.mjs`, che
 * scrive anche il marcatore `~/.omp/agent/config-sync.json` col percorso del
 * clone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Marker = {
	repo: string;
	/** 0 = a ogni sessione. */
	pullEveryHours?: number;
	/** false = segnala la deriva senza toccare la configurazione. */
	autoApply?: boolean;
};

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

const MARKER = join(
	// `import.meta.dirname` è `<agent-dir>/extensions`.
	dirname(import.meta.dirname),
	"config-sync.json",
);

export default function hook(pi: HookAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		let marker: Marker;
		try {
			marker = JSON.parse(readFileSync(MARKER, "utf8")) as Marker;
		} catch {
			return; // Nessun clone registrato: l'estensione è inerte.
		}

		const stamp = join(dirname(MARKER), "config-sync-stamp");
		const everyHours = marker.pullEveryHours ?? 6;
		let lastPull = 0;
		try {
			lastPull = Number(readFileSync(stamp, "utf8")) || 0;
		} catch {
			// Prima sessione dopo l'installazione.
		}

		if (Date.now() - lastPull > everyHours * 3_600_000) {
			// Solo fast-forward: un merge da risolvere non si fa all'avvio di una
			// sessione, e lì il repo va guardato a mano.
			const pull = await pi.exec("git", ["pull", "--ff-only", "--quiet"], {
				cwd: marker.repo,
			});
			if (pull.code !== 0) {
				pi.logger.warn(
					`config-sync: git pull fallito — ${`${pull.stderr ?? ""}${pull.stdout ?? ""}`.trim()}`,
				);
			}
			writeFileSync(stamp, String(Date.now()));
		}

		const mode = marker.autoApply === false ? "check" : "apply";
		const run = await pi.exec("node", [join("scripts", "sync.mjs"), mode], {
			cwd: marker.repo,
		});
		const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();

		// `check` esce 1 quando trova deriva: è un esito, non un guasto.
		if (run.code !== 0 && !(mode === "check" && run.code === 1)) {
			pi.logger.warn(`config-sync: ${output}`);
			return;
		}

		const changes = output
			.split(/\r?\n/)
			.filter(line => line.startsWith("✘"))
			.map(line => line.replace(/^✘\s*/, "").split(":")[0]);
		if (changes.length === 0) return;

		pi.logger.info(`config-sync (${mode}): ${changes.join(", ")}`);
		if (!ctx.hasUI) return;
		// Le impostazioni si leggono all'avvio: questa sessione ha già i vecchi valori.
		ctx.ui.notify(
			mode === "apply"
				? `Configurazione omp aggiornata dal repo (${changes.join(", ")}). Riapri la sessione per vederla attiva.`
				: `Configurazione omp diversa dal repo (${changes.join(", ")}). Allinea con \`node scripts/sync.mjs apply\` in ${marker.repo}.`,
		);
	});
}
