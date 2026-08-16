// Turning what somebody uploaded into something small enough to keep.
//
// Every image in this app is stored as a base64 string inside a database row
// — photos, signed waivers, vaccination records, the logo, the website
// gallery. That makes size a correctness concern rather than a nicety: rows
// are what fills the database, and a page that loads a hundred dogs loads a
// hundred photos with them.
//
// So nothing here resizes and hopes. Everything comes out under a stated
// byte budget.
// ---------------------------------------------------------------------
// Vaccination records
// ---------------------------------------------------------------------
//
// Records are the one thing that actually fills this database. Photos are
// resized to 640px and land around 100 KB; a record was resized to 1200px
// (small print on a vet printout has to stay readable) and a PDF was not
// resized at all, so a scanned certificate could be several megabytes sitting
// inside a database row.
//
// Everything now comes out as one JPEG under a size budget, whatever went in.
// A PDF is rendered rather than refused, because a PDF emailed by the vet is
// the most common thing an owner actually has — telling them to photograph
// their screen instead gets a worse image than the one being turned down.

/** Roughly what a data URL costs to store. Base64 is 4 bytes per 3. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  return Math.round(((comma < 0 ? dataUrl.length : dataUrl.length - comma - 1) * 3) / 4);
}

/**
 * A JPEG under `targetBytes`, giving up quality before resolution.
 *
 * That order matters for documents: text at 1200px and quality 0.5 stays
 * readable, while the same bytes spent at 700px and quality 0.9 does not.
 * Only once quality is exhausted does it start shrinking the page.
 */
function canvasToBudgetedJpeg(canvas: HTMLCanvasElement, targetBytes: number): string {
  let best = canvas.toDataURL("image/jpeg", 0.85);
  for (let quality = 0.75; dataUrlBytes(best) > targetBytes && quality >= 0.35; quality -= 0.1) {
    best = canvas.toDataURL("image/jpeg", quality);
  }
  // Still over budget: the page is genuinely dense, so now scale it down.
  let guard = 0;
  while (dataUrlBytes(best) > targetBytes && guard < 3) {
    guard += 1;
    const smaller = document.createElement("canvas");
    smaller.width = Math.round(canvas.width * 0.75 ** guard);
    smaller.height = Math.round(canvas.height * 0.75 ** guard);
    const ctx = smaller.getContext("2d");
    if (!ctx) break;
    ctx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    best = smaller.toDataURL("image/jpeg", 0.6);
  }
  return best;
}

function drawToCanvas(img: HTMLImageElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Pages beyond this are dropped — a vaccination record is not a book. */
const MAX_PDF_PAGES = 4;

const WORKER_URL = "/pdf.worker.min.mjs";

/**
 * Thrown when the pdf.js worker is not being served.
 *
 * Worth its own type because of how it presented the first time: the worker
 * 404s, pdf.js fails to start, and the enrollment form told somebody their
 * vaccination certificate was unreadable. The file was fine. The deployment
 * was missing a file, and the message sent the client to look at their
 * scanner.
 *
 * The worker is copied into /public before every dev and build, so the way
 * to end up without it is to pull the repo with a server already running, or
 * to deploy in a way that skips the copy. Both are recoverable in seconds by
 * somebody who is told what is wrong.
 */
export class PdfWorkerMissingError extends Error {
  constructor() {
    super(
      "The PDF reader is not available on this server. Restart it, or run npm install, so the pdf.js worker is copied into public/."
    );
    this.name = "PdfWorkerMissingError";
  }
}

/**
 * Every page of a PDF, stacked into one tall JPEG.
 *
 * Stacking rather than keeping only page one: a rabies certificate is
 * regularly two pages, and silently storing half a document is worse than
 * refusing it. One image also keeps the rest of the app unchanged — the
 * preview, the profile and the printed report all already handle an image.
 *
 * pdf.js is around a megabyte, so it is only fetched when somebody actually
 * picks a PDF. The kiosk is often on lobby wi-fi and should not pay for a
 * library it will rarely use.
 */
async function pdfToJpeg(file: File, maxDim: number, targetBytes: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Served from /public rather than referenced through the bundler.
  //
  // This used to be new URL("pdfjs-dist/build/pdf.worker.min.mjs",
  // import.meta.url), which reads like the modern way to do it and broke
  // `next build` completely: webpack treats that pattern as an instruction to
  // bundle the target, so it pulled the worker in and handed it to SWC, which
  // parsed a file full of import.meta as a script and failed.
  //
  // The worker is not a module this app imports. It is a separate file the
  // browser fetches at runtime, and scripts/copy-pdf-worker.mjs puts the copy
  // matching the installed pdfjs into /public before every dev and build.
  pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;

  // Asked for once, before pdf.js is handed a document, so a missing worker
  // reports itself as a missing worker. Left to pdf.js it surfaces as
  // "Setting up fake worker failed", which every layer above turns into
  // "could not read that file" - a message about the wrong thing entirely.
  const workerReady = await fetch(WORKER_URL, { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  if (!workerReady) throw new PdfWorkerMissingError();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(doc.numPages, MAX_PDF_PAGES);

  const pages: HTMLCanvasElement[] = [];
  for (let n = 1; n <= count; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    // Render at the target width rather than shrinking afterwards, so the
    // text is rasterised at the size it will be read at.
    const viewport = page.getViewport({ scale: maxDim / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    // PDF pages are transparent; without this the text renders on black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  if (pages.length === 0) throw new Error("That PDF has no pages");

  const width = Math.max(...pages.map((c) => c.width));
  const height = pages.reduce((sum, c) => sum + c.height, 0);
  const sheet = document.createElement("canvas");
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const page of pages) {
    ctx.drawImage(page, 0, y);
    y += page.height;
  }

  // A stacked sheet is taller, so it gets proportionally more room.
  return canvasToBudgetedJpeg(sheet, targetBytes * Math.min(pages.length, 2));
}

/**
 * Any image, resized and then squeezed until it fits a byte budget.
 *
 * Resizing alone does not bound the result: a detailed 1600px photograph and
 * a flat one come out an order of magnitude apart at the same dimensions, so
 * a picture that "should" be 200 KB can arrive as several megabytes. Since
 * these are stored inside database rows, the size has to be a promise rather
 * than a hope.
 */
export async function fileToBudgetedJpeg(
  file: File,
  maxDim: number,
  targetBytes: number
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => {
      const el = new window.Image();
      el.onerror = () => reject(new Error("Could not read image"));
      el.onload = () => resolve(el);
      el.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
  return canvasToBudgetedJpeg(drawToCanvas(img, maxDim), targetBytes);
}

/**
 * A vaccination record as one budgeted JPEG, from an image or a PDF.
 *
 * 1200px because a vet's printout has small print on it; 150 KB because that
 * is what keeps five hundred dogs' paperwork inside a free database rather
 * than several hundred megabytes of it.
 */
export async function fileToRecordJpeg(
  file: File,
  maxDim = 1200,
  targetBytes = 150 * 1024
): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return pdfToJpeg(file, maxDim, targetBytes);
  }
  return fileToBudgetedJpeg(file, maxDim, targetBytes);
}

/**
 * Why a picture would not open, said in a way somebody at the front desk can
 * act on.
 *
 * The usual cause is HEIC. iPhones and iPads shoot in it by default, Safari
 * can display it and Chrome cannot, so a photo that looks perfectly normal in
 * the Photos app fails to decode the moment it reaches a canvas. The failure
 * arrives as a bare image onerror with nothing in it, so the file has to be
 * inspected to say anything useful.
 *
 * Naming the format matters more than it looks: "try a different file" sends
 * staff hunting through a photo library for one that happens to work, without
 * ever learning which ones will.
 */
export function unreadableImageMessage(file: File): string {
  const name = file.name.toLowerCase();
  const heic =
    name.endsWith(".heic") ||
    name.endsWith(".heif") ||
    file.type === "image/heic" ||
    file.type === "image/heif";

  if (heic) {
    return (
      "That is an iPhone HEIC photo, which this browser cannot open. " +
      "In Photos, use Share and pick JPEG — or set the camera to Most Compatible " +
      "(Settings → Camera → Formats) so new photos are JPEG from the start."
    );
  }

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "That is a PDF. A dog photo needs to be a picture — JPEG or PNG.";
  }

  if (file.size > 25 * 1024 * 1024) {
    return `That file is ${Math.round(file.size / (1024 * 1024))} MB, which is too large to open. Try a smaller picture.`;
  }

  return "That picture could not be opened — it may be damaged or in a format this browser does not read. JPEG and PNG always work.";
}
