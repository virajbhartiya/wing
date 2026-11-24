import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

const make = (d: React.ReactNode) =>
  function Icon({ size, ...rest }: P) {
    return (
      <svg {...base(size)} {...rest}>
        {d}
      </svg>
    );
  };

export const Back = make(<path d="m15 18-6-6 6-6" />);
export const Forward = make(<path d="m9 18 6-6-6-6" />);
export const Reload = make(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>);
export const SidebarIcon = make(<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></>);
export const Plus = make(<path d="M12 5v14M5 12h14" />);
export const Close = make(<path d="M18 6 6 18M6 6l12 12" />);
export const Search = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const Globe = make(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const Star = make(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />);
export const SplitIcon = make(<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16" /></>);
export const Puzzle = make(<path d="M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4Z" />);
export const Expand = make(<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />);
export const Spark = make(<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />);
export const Mic = make(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const Camera = make(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>);
export const Screen = make(<><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>);
export const Tab = make(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18" /></>);
export const Window = make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18M6 6h.01M8.5 6h.01" /></>);
export const Check = make(<path d="m5 12 5 5 9-10" />);
export const Phone = make(<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />);
export const Play = make(<path d="M7 4v16l13-8Z" fill="currentColor" />);
export const Archive = make(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10h14V9M10 13h4" /></>);
