/**
 * Unico file che `install.mjs` copia in `~/.omp/agent/extensions/`: la logica
 * sta nel clone e viene importata da lì, così `git pull` aggiorna anche
 * l'estensione. Questo stub non ha motivo di cambiare.
 *
 * La copia serve perché omp consegna gli eventi di sessione solo agli hook
 * trovati nelle cartelle di discovery (`<agent-dir>/extensions`,
 * `<cwd>/.omp/extensions`): un percorso dichiarato in `extensions:` viene
 * caricato, ma i suoi `pi.on(...)` non ricevono niente.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type HookContext = { hasUI: boolean; ui: { notify(message: string): void } };

type HookAPI = {
	logger: { warn(message: string): void };
	on(
		event: "session_start",
		handler: (event: unknown, ctx: HookContext) => Promise<void>,
	): void;
};

// `import.meta.dirname` è `<agent-dir>/extensions`.
const MARKER = join(dirname(import.meta.dirname), "config-sync.json");

export default function hook(pi: HookAPI): void {
	// La registrazione è sincrona: importare prima di `pi.on` rischierebbe di
	// arrivare a evento già emesso.
	pi.on("session_start", async (_event, ctx) => {
		let repo: string;
		try {
			repo = (JSON.parse(readFileSync(MARKER, "utf8")) as { repo: string }).repo;
		} catch {
			return; // Nessun clone registrato: lo stub è inerte.
		}

		// Import dinamico obbligato: il percorso del clone lo conosce solo il
		// marcatore, a runtime. Su Windows serve un URL `file://`.
		const url = pathToFileURL(join(repo, "extensions", "config-sync.ts")).href;
		try {
			const module = (await import(url)) as {
				onSessionStart(
					pi: HookAPI,
					ctx: HookContext,
					repo: string,
				): Promise<void>;
			};
			await module.onSessionStart(pi, ctx, repo);
		} catch (error) {
			pi.logger.warn(`config-sync: ${String(error)}`);
		}
	});
}
