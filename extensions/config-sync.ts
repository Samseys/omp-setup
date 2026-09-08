/**
 * Segnala all'avvio della sessione se il setup omp di questa macchina si è
 * discostato dal repo. Non tocca niente e non fa rete: la deriva è
 * un'informazione, la direzione in cui risolverla la decide chi legge.
 *
 * Installata in `~/.omp/agent/extensions/` da `scripts/install.mjs`, che
 * scrive anche il marcatore `~/.omp/agent/config-sync.json` col percorso del
 * clone.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

// `import.meta.dirname` è `<agent-dir>/extensions`.
const MARKER = join(dirname(import.meta.dirname), "config-sync.json");

export default function hook(pi: HookAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		let repo: string;
		try {
			repo = (JSON.parse(readFileSync(MARKER, "utf8")) as { repo: string }).repo;
		} catch {
			return; // Nessun clone registrato: l'estensione è inerte.
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

		const changed = `${run.stdout ?? ""}`
			.split(/\r?\n/)
			.filter(line => line.startsWith("✘"))
			.map(line => line.replace(/^✘\s*/, "").split(":")[0]);
		if (changed.length === 0) return;

		pi.logger.info(`config-sync: deriva su ${changed.join(", ")}`);
		if (!ctx.hasUI) return;
		ctx.ui.notify(
			`Setup omp diverso dal repo (${changed.join(", ")}). Usa /skill:setup-omp per allineare in una direzione o nell'altra.`,
		);
	});
}
