// Toggles a Safari-style reader over the current page. Readability.js is
// prepended at runtime; the article stays in the page's own origin, inside a
// closed shadow root so page styles cannot reach it.
const existing = document.getElementById("wing-reader-host");
if (existing) {
  existing.dispatchEvent(new Event("wing-reader-close"));
  return { reader: false };
}
const article = new Readability(document.cloneNode(true), {
  charThreshold: 400,
}).parse();
if (!article || !article.content || article.length < 400)
  return { reader: false, unavailable: true };

const host = document.createElement("div");
host.id = "wing-reader-host";
host.style.cssText =
  "all:initial;position:fixed;inset:0;z-index:2147483647;display:block";
const root = host.attachShadow({ mode: "closed" });
const sheet = new CSSStyleSheet();
// Classes are prefixed: Readability's own output uses names like "page".
sheet.replaceSync(`
:host { color-scheme: light dark; }
.wr-page { position: fixed; inset: 0; overflow: auto; background: #fbfaf8; color: #1d1d1f;
  font: 20px/1.6 "New York", ui-serif, Georgia, serif; animation: wr-in 180ms ease-out; }
@media (prefers-color-scheme: dark) { .wr-page { background: #1e1e20; color: #e8e6e3; } .wr-page a { color: #8ab4ff; } }
@keyframes wr-in { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .wr-page { animation: none; } }
.wr-article { max-width: 680px; margin: 0 auto; padding: 72px 32px 120px; }
.wr-header { margin-bottom: 36px; }
.wr-site { font: 600 13px/1.3 -apple-system, system-ui, sans-serif; letter-spacing: .02em;
  text-transform: uppercase; opacity: .55; }
.wr-title { font-size: 36px; line-height: 1.18; margin: 10px 0 12px; font-weight: 700; }
.wr-byline { font: 15px/1.4 -apple-system, system-ui, sans-serif; opacity: .65; }
.wr-content * { position: static !important; max-width: 100%; }
.wr-content img, .wr-content video, .wr-content picture, .wr-content svg { height: auto; }
.wr-content figure { margin: 28px 0; }
.wr-content figcaption { font: 14px/1.45 -apple-system, system-ui, sans-serif; opacity: .65; margin-top: 8px; }
.wr-content pre, .wr-content code { font: 15px/1.5 ui-monospace, Menlo, monospace; }
.wr-content pre { overflow: auto; padding: 14px 16px; border-radius: 8px; background: rgba(127,127,127,.12); }
.wr-content blockquote { margin: 24px 0; padding-left: 20px; border-left: 3px solid rgba(127,127,127,.35); opacity: .85; }
.wr-page a { color: #0a5bd3; }
.wr-content table { border-collapse: collapse; font-size: 16px; display: block; overflow: auto; }
.wr-content td, .wr-content th { border: 1px solid rgba(127,127,127,.3); padding: 6px 10px; }
.wr-close { position: fixed; top: 16px; right: 18px; width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: rgba(127,127,127,.16); color: inherit; font: 16px/30px -apple-system, system-ui; cursor: default; }
.wr-close:hover { background: rgba(127,127,127,.26); }
`);
root.adoptedStyleSheets = [sheet];
const page = document.createElement("div");
page.className = "wr-page";
page.innerHTML = `<button class="wr-close" aria-label="Close reader" title="Close Reader · esc">✕</button><div class="wr-article"><div class="wr-header"><div class="wr-site"></div><h1 class="wr-title"></h1><div class="wr-byline"></div></div><div class="wr-content"></div></div>`;
page.querySelector(".wr-site").textContent =
  article.siteName || location.hostname.replace(/^www\./, "");
page.querySelector(".wr-title").textContent = article.title || document.title;
page.querySelector(".wr-byline").textContent = article.byline || "";
page.querySelector(".wr-content").innerHTML = article.content;
for (const link of page.querySelectorAll(".wr-content a[href]"))
  link.target = "_top";
root.append(page);

const previousOverflow = document.documentElement.style.overflow;
const close = () => {
  document.documentElement.style.overflow = previousOverflow;
  removeEventListener("keydown", onKey, true);
  host.remove();
};
const onKey = (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
};
host.addEventListener("wing-reader-close", close);
page.querySelector(".wr-close").addEventListener("click", close);
addEventListener("keydown", onKey, true);
document.documentElement.style.overflow = "hidden";
document.documentElement.append(host);
page.focus();
return { reader: true, title: article.title };
