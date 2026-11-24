import type { Chapter } from "@/demo/state";

export type ChapterCopy = { id: Chapter; label: string; title: string; body: string; try: string };

export const COPY: ChapterCopy[] = [
  { id: "hero", label: "Live demo", title: "Go ahead, click around.", body: "This is Wing. The tabs, Spaces and shortcuts in this window all work.", try: "Press ⌘K · shift-click a link · drag a tab onto the page" },
  { id: "spaces", label: "Spaces", title: "A room for each part of your life.", body: "Work, Personal, Studio. Each Space keeps its own tabs, favorites and logins, so nothing bleeds into anything else.", try: "Swipe the sidebar, or press ⌃1, ⌃2, ⌃3" },
  { id: "palette", label: "Command palette", title: "Everything is one keystroke away.", body: "Every tab in every Space, every action, and the web. Type a few letters and press Enter.", try: "Type “noodles” and press Enter" },
  { id: "split", label: "Split view", title: "Two pages. One window.", body: "Put the docs next to the dashboard. Drag the divider to give either side more room.", try: "Drag the divider, or drag a tab onto the page" },
  { id: "peek", label: "Peek", title: "Look without leaving.", body: "Shift-click a link and it floats over the page you're on. Keep it as a tab, or let it go.", try: "Open it as a tab, or press Esc" },
  { id: "extensions", label: "Chrome extensions", title: "Install from the Chrome Web Store.", body: "The Mac app uses Chromium’s extension system. Compatibility varies by extension.", try: "Click “Add to Wing”" },
  { id: "calls", label: "Calls", title: "Calls stay live. You pick what's shared.", body: "Meet, Zoom and Teams keep running while you switch tabs. When a site asks for your screen, share one tab, one window or everything.", try: "Pick what to share, then switch tabs" },
  { id: "layout", label: "Your layout", title: "Tabs on top, or in a sidebar.", body: "Start with Safari's toolbar and top tabs. Move them to a sidebar whenever you like.", try: "Press ⌥⌘S, or click the sidebar button" },
];
