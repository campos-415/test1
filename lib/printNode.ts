// Printing one thing off a page, rather than printing the page.
//
// window.print() prints the whole document, which means the printed result
// depends on every rule, wrapper and script on it. The first-day report went
// blank three times over: the sheet itself renders correctly under the app's
// own print rules — checked by lifting every @media print block out of the
// stylesheets and applying it unconditionally — so what was breaking it was
// somewhere in the surrounding page, and reading the code did not find it.
//
// So the sheet is copied into an iframe of its own and that is printed. The
// app's stylesheets come with it, so it looks the same; nothing else does, so
// nothing else can blank it. It also cannot white out the screen, because the
// visible document is never re-laid-out for print at all.
//
// The trade is that this prints a SNAPSHOT. Anything not in the DOM at the
// moment of the call is not in it — which is why the sheet renders its typed
// answers into real elements rather than leaving them as input values.

/** Copies the CSS custom properties the theme sets on <html> at runtime. */
function themeStyle(): string {
  return document.documentElement.getAttribute("style") ?? "";
}

export async function printNode(node: HTMLElement, title: string): Promise<void> {
  const frame = document.createElement("iframe");
  // Present but invisible. display:none would stop some browsers laying the
  // document out at all, and an unlaid-out document prints blank.
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    frame.remove();
    // Better a whole-page print than none at all.
    window.print();
    return;
  }

  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body></body></html>`);
  doc.close();

  // The theme variables live inline on <html>, so the accent and paper
  // colours only exist if they are carried across. Deliberately WITHOUT the
  // dark class: paper is light, whatever the screen is set to.
  doc.documentElement.setAttribute("style", themeStyle());

  const sheets = Array.from(
    document.querySelectorAll('link[rel="stylesheet"], style')
  ) as HTMLElement[];
  const pending: Promise<unknown>[] = [];
  for (const sheet of sheets) {
    const copy = sheet.cloneNode(true) as HTMLElement;
    doc.head.appendChild(copy);
    if (copy.tagName === "LINK") {
      pending.push(
        new Promise((resolve) => {
          copy.addEventListener("load", resolve, { once: true });
          copy.addEventListener("error", resolve, { once: true });
        })
      );
    }
  }

  doc.body.innerHTML = node.outerHTML;

  // Wait for the stylesheets, and for any image in the sheet — a dog photo
  // that has not decoded yet prints as a gap.
  const images = Array.from(doc.images).map((img) =>
    img.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        })
  );

  await Promise.race([
    Promise.all([...pending, ...images]),
    // Never hang on a stylesheet that will not load. A slightly unstyled
    // sheet beats a button that does nothing.
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  win.focus();
  win.print();

  // Left in place briefly: some browsers return from print() before the
  // dialog has finished with the document, and removing it too early prints
  // a blank sheet.
  setTimeout(() => frame.remove(), 1000);
}
