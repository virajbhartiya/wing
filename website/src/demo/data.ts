export type PageKind = "docs" | "dashboard" | "review" | "mail" | "article" | "recipe" | "music" | "design" | "call" | "store" | "changelog";

export type Page = { id: string; title: string; host: string; kind: PageKind; glyph: string };

export const PAGES: Record<string, Page> = {
  docs: { id: "docs", title: "Northwind Docs — Deploying", host: "northwind.so/docs", kind: "docs", glyph: "N" },
  dash: { id: "dash", title: "Launch dashboard", host: "northwind.so", kind: "dashboard", glyph: "N" },
  review: { id: "review", title: "Review: faster cold start", host: "forge.dev/northwind/pull/482", kind: "review", glyph: "F" },
  mail: { id: "mail", title: "Inbox (3)", host: "postbox.app", kind: "mail", glyph: "P" },
  article: { id: "article", title: "The case for a quieter web", host: "longform.press", kind: "article", glyph: "L" },
  recipe: { id: "recipe", title: "Weeknight sesame noodles", host: "larder.kitchen", kind: "recipe", glyph: "L" },
  music: { id: "music", title: "Low Light — Tidepool", host: "tidepool.fm", kind: "music", glyph: "T" },
  design: { id: "design", title: "Brand v3 — Canvas", host: "canvas.studio", kind: "design", glyph: "C" },
  call: { id: "call", title: "Standup — Huddle", host: "huddle.video/standup", kind: "call", glyph: "H" },
  store: { id: "store", title: "Extensions", host: "extensions.gallery", kind: "store", glyph: "E" },
  changelog: { id: "changelog", title: "Changelog — Northwind", host: "northwind.so/changelog", kind: "changelog", glyph: "N" },
};

export type Space = { name: string; glyph: string; favorites: string[]; tabs: string[] };

export const SPACES: Space[] = [
  { name: "Work", glyph: "◐", favorites: ["mail", "dash"], tabs: ["docs", "dash", "review"] },
  { name: "Personal", glyph: "◑", favorites: ["music"], tabs: ["article", "recipe", "music"] },
  { name: "Studio", glyph: "◒", favorites: ["call"], tabs: ["design", "call", "store"] },
];
