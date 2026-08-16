// Puts the pdf.js worker where the browser can fetch it.
//
// pdf.js runs its parser in a Web Worker, which is a separate file the
// browser loads at runtime rather than something this app imports. The
// obvious way to point at it —
//
//   new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
//
// — is the documented pattern and it broke `next build` outright: webpack
// reads that as "bundle this", pulled the worker into the graph, and SWC
// then failed to parse a file full of import.meta. `next dev` never bundles
// the worker, so the breakage was invisible until a production build.
//
// So the worker is copied into /public and referenced by path. Copied rather
// than committed, so it cannot drift from the installed pdfjs: upgrade the
// package and the next dev or build picks up the matching worker. A
// mismatched pair fails at runtime with a version error, which is exactly the
// kind of thing that would otherwise be found by a client trying to upload a
// vaccination certificate.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const WORKER = "pdfjs-dist/build/pdf.worker.min.mjs";
const DESTINATION = join(process.cwd(), "public", "pdf.worker.min.mjs");

async function main() {
  let source;
  try {
    source = require.resolve(WORKER);
  } catch {
    // Not installed yet. This runs before dev and before build, and on a
    // fresh clone the first of those can happen before npm install has
    // finished. A missing worker is only a problem for PDF uploads, so it
    // says so and lets the build proceed rather than failing everything.
    console.warn(
      `[pdf-worker] Could not find ${WORKER}. PDF vaccination records will not load until pdfjs-dist is installed.`
    );
    return;
  }

  await mkdir(dirname(DESTINATION), { recursive: true });

  // Skip an identical copy so this is not a write on every dev server start.
  try {
    const [from, to] = await Promise.all([stat(source), stat(DESTINATION)]);
    if (from.size === to.size && to.mtimeMs >= from.mtimeMs) return;
  } catch {
    // No copy yet, or it is unreadable. Fall through and write one.
  }

  await copyFile(source, DESTINATION);
  console.log(`[pdf-worker] Copied ${WORKER} into public/`);
}

main().catch((e) => {
  console.warn("[pdf-worker] Could not copy the worker:", e.message);
});
