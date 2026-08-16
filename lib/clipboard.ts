/**
 * Copy text to the clipboard, with the fallback that used to be a prompt().
 *
 * navigator.clipboard only exists in a secure context, so it is missing on a
 * front-desk machine reaching the app over plain http on the local network —
 * exactly the case the fallback was there for. The old fallback opened a
 * window.prompt() with the link selected — which assumes a browser that has
 * one: an embedded browser can throw on the call, and Chrome lets the user
 * suppress it.
 *
 * A hidden textarea plus the deprecated-but-universal execCommand("copy")
 * covers the same ground without a dialog. Returns false only when neither
 * worked, which is the caller's cue to put the text on screen so it can be
 * read out or selected by hand.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked by permission or an insecure context — try the old way.
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    // Off-screen rather than hidden: display:none and visibility:hidden are
    // both unselectable, so the copy would silently take nothing.
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
