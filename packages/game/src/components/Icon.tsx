import type { ReactNode } from "react";

/**
 * Round 8 (B): the game's UI icons. One set, drawn for this game on a 24 px grid with a 1.75 px round stroke in
 * currentColor, so an icon always takes its button's or label's colour (and its contrast). Emoji stay where they are
 * content a child enjoys (food, mood faces, districts, incidents); chrome uses these.
 *
 *   <Icon name="settings" />                     decorative: aria-hidden, the button carries the name
 *   <Icon name="warning" title="Warning" />      meaningful on its own: role="img" with a <title>
 *
 * Solid shapes (play, pause, fast-forward) are filled; everything else is a line drawing.
 */
const S = { fill: "currentColor", stroke: "none" } as const;
const DOT = (cx: number, cy: number, r = 1.15) => <circle cx={cx} cy={cy} r={r} {...S} />;

export const ICONS = {
  menu: <><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h3.5" /></>,
  stock: <><path d="M4 8l8-4 8 4v8.5L12 21l-8-4.5z" /><path d="M4 8l8 4.5L20 8M12 12.5V21" /></>,
  rota: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.4" /><path d="M15.6 14.4A4.6 4.6 0 0 1 21 19" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><circle cx="17" cy="9" r="2.4" /><path d="M15.6 14.4A4.6 4.6 0 0 1 21 19" /></>,
  chefHat: <><path d="M7 16.5v-3A3.8 3.8 0 0 1 8.3 6.2a4 4 0 0 1 7.4 0A3.8 3.8 0 0 1 17 13.5v3" /><rect x="7" y="16.5" width="10" height="3.5" rx="1" /></>,
  money: <><circle cx="12" cy="12" r="9" /><path d="M14.6 8.6a2.4 2.4 0 0 0-4.3 1.5V16M8.6 13h4.2M8.6 16h6.8" /></>,
  stars: <path d="M12 3.6l2.55 5.2 5.7.82-4.13 4.03.98 5.68L12 16.65l-5.1 2.68.98-5.68L3.75 9.62l5.7-.82z" />,
  empire: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.6 3.6 5.6 3.6 9s-1 6.4-3.6 9c-2.6-2.6-3.6-5.6-3.6-9S9.4 5.6 12 3z" /></>,
  shop: <><path d="M3.5 9.5L5.5 4h13l2 5.5" /><path d="M3.5 9.5h17a2.8 2.8 0 0 1-5.6 0 2.8 2.8 0 0 1-5.6 0 2.8 2.8 0 0 1-5.8 0z" /><path d="M5 12v8.5h14V12M10 20.5v-5h4v5" /></>,
  restaurant: <><path d="M3 9.5h18l-2 3H5z" /><path d="M7 12.5V20M17 12.5V20M9.5 6.5h5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.6" /><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.35 5.35l2 2M16.65 16.65l2 2M5.35 18.65l2-2M16.65 7.35l2-2" /></>,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" /></>,
  soundOff: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>,
  textSize: <><path d="M3.5 18l4.6-12h1L13.7 18M5.4 14h6.4" /><path d="M15 18l2.9-7.5h.6L21.4 18M16 15.5h4.4" /></>,
  speed: <><path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" /><path d="M12 13.5l4.2-4.2" />{DOT(12, 13.5, 1.6)}</>,
  pause: <><rect x="6.5" y="5" width="4" height="14" rx="1.2" {...S} /><rect x="13.5" y="5" width="4" height="14" rx="1.2" {...S} /></>,
  play: <path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" {...S} />,
  fastForward: <path d="M3 6.2v11.6a.7.7 0 0 0 1.1.6l7.4-5.8a.7.7 0 0 0 0-1.2L4.1 5.6A.7.7 0 0 0 3 6.2zM12 6.2v11.6a.7.7 0 0 0 1.1.6l7.4-5.8a.7.7 0 0 0 0-1.2l-7.4-5.8a.7.7 0 0 0-1.1.6z" {...S} />,
  fastest: <path d="M1.5 7v10l5.6-5zM8.7 7v10l5.6-5zM15.9 7v10l5.6-5z" {...S} strokeLinejoin="round" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  back: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  forward: <path d="M5 12h13.5M13 6l6 6-6 6" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" />{DOT(12, 7.8)}</>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.5" />{DOT(12, 16.9)}</>,
  warning: <><path d="M10.6 4.6a1.6 1.6 0 0 1 2.8 0l7.6 13.3a1.6 1.6 0 0 1-1.4 2.4H4.4A1.6 1.6 0 0 1 3 17.9z" /><path d="M12 9.5v4" />{DOT(12, 16.7)}</>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pin: <><path d="M12 21s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" /><circle cx="12" cy="9.8" r="2.4" /></>,
  trendUp: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  trendDown: <><path d="M3 7l6 6 4-4 8 8" /><path d="M15 17h6v-6" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" /></>,
  service: <><path d="M4.5 16.5a7.5 7.5 0 0 1 15 0z" /><path d="M3 19.5h18M12 9V7.2M10.4 7h3.2" /></>,
  moon: <path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z" />,
  trophy: <><path d="M8 4h8v5.5a4 4 0 0 1-8 0z" /><path d="M8 6H5.2a3 3 0 0 0 3.1 4.2M16 6h2.8a3 3 0 0 1-3.1 4.2M12 13.5V17M8.5 20h7M9.5 17h5v3h-5z" /></>,
  smile: <><circle cx="12" cy="12" r="9" /><path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0" />{DOT(9, 9.8)}{DOT(15, 9.8)}</>,
  timer: <><path d="M7 3.5h10M7 20.5h10M8 3.5c0 4.5 4 5.5 4 8.5s-4 4-4 8.5M16 3.5c0 4.5-4 5.5-4 8.5s4 4 4 8.5" /></>,
  walkOut: <><path d="M13 4H6v16h7" /><path d="M10.5 12H21M17.5 8.5L21 12l-3.5 3.5" /></>,
  key: <><circle cx="8" cy="15.5" r="4" /><path d="M11 12.5l9-9M16.5 7l2.5 2.5M14 9.5l2 2" /></>,
  knife: <><path d="M14.5 9.5L20 4M4 20l10.5-10.5 2.8 2.8C14.6 16.2 9.6 19 4 20z" /></>,
  glass: <><path d="M5 4.5h14l-7 7.5z" /><path d="M12 12v7.5M8 19.5h8M7.6 7.5h8.8" /></>,
  clipboard: <><rect x="5.5" y="4.5" width="13" height="16.5" rx="2" /><path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3.5" /></>,
  gamepad: <><path d="M7 7.5h10a4.5 4.5 0 0 1 4.4 5.5l-.8 3.6a2.2 2.2 0 0 1-3.8 1L14.7 15H9.3l-2.1 2.6a2.2 2.2 0 0 1-3.8-1L2.6 13A4.5 4.5 0 0 1 7 7.5z" /><path d="M7.5 10.2v3.6M5.7 12h3.6" />{DOT(15.6, 11)}{DOT(17.6, 13)}</>,
  heart: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  chilli: <><path d="M16.6 8.4c1.6 5.6-3.5 11.8-11.8 11.6.2-1.1 1-1.9 2.2-2.4 5.3-2.3 6.6-5.4 6.9-8.8" /><path d="M13.9 8.8c.6-1.4 1.8-1.8 2.7-.4M16.6 8.4c0-2 .9-3.6 2.9-4.4" /></>,
  balance: <><path d="M12 4v16M8 20h8M5 7h14" /><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" />{DOT(12, 12, 1.8)}</>,
  chart: <><path d="M4 4v16h16" /><rect x="7.5" y="11" width="3" height="6" rx="0.8" /><rect x="12.5" y="7" width="3" height="10" rx="0.8" /><rect x="17.2" y="13" width="2.6" height="4" rx="0.8" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15.5" rx="2" /><path d="M4 9.5h16M8.5 3v4M15.5 3v4" /></>,
  // Round 9: saves (the slot picker's pencil / trash / upload are drawn in SlotPicker.tsx, outside the main chunk).
  cloud: <path d="M7 18.5h10.2a4.3 4.3 0 0 0 .6-8.55A5.8 5.8 0 0 0 6.6 9.1 4.7 4.7 0 0 0 7 18.5z" />,
  cloudOff: <><path d="M9.2 18.5h8a4.3 4.3 0 0 0 2.6-.88M20.9 14.2a4.3 4.3 0 0 0-3.1-4.25A5.8 5.8 0 0 0 9.7 5.3M6.3 8.2A4.7 4.7 0 0 0 7 18.5h2" /><path d="M3.5 3.5l17 17" /></>,
  save: <><path d="M5 4h11.5L20 7.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M8 4v5h7V4M7.5 20v-6h9v6" /></>,
  folder: <path d="M3.5 7V18a1.5 1.5 0 0 0 1.5 1.5h14A1.5 1.5 0 0 0 20.5 18V9.5A1.5 1.5 0 0 0 19 8h-7.2L9.6 5.5H5A1.5 1.5 0 0 0 3.5 7z" />,
  download: <><path d="M12 4v11.5M7.5 11L12 15.5l4.5-4.5" /><path d="M4.5 15v4.5h15V15" /></>,
  // Round 10 (A, decorating): the Decorate tab and its slots.
  paint: <><rect x="4" y="3.5" width="13" height="5.5" rx="1.5" /><path d="M17 6.2h2.5v5H11.5v3" /><rect x="10" y="14.2" width="3" height="6.5" rx="1" /></>,
  lamp: <><path d="M12 3v4.5M7 13.5a5 5 0 0 1 10 0z" /><path d="M10.5 16.5a1.5 1.5 0 0 0 3 0M5 19.5l1.3-1.3M19 19.5l-1.3-1.3M12 21v-1.2" /></>,
  plant: <><path d="M7.5 15h9l-1.2 5.5H8.7z" /><path d="M12 15V8.5M12 11c-3.6.3-5.4-1.6-5.5-4.8 3.3-.1 5.3 1.6 5.5 4.8zM12 9.5c.3-3 2.2-4.7 5.4-4.6-.1 3.1-1.8 4.8-5.4 4.6z" /></>,
  music: <><path d="M9 17.5V6l10-2v11" /><circle cx="6.8" cy="17.5" r="2.4" /><circle cx="16.8" cy="15" r="2.4" /></>,
  chair: <><path d="M7 3.5h10v8H7z" /><path d="M5.5 11.5h13v3h-13zM7 14.5V21M17 14.5V21" /></>,
  sign: <><path d="M12 3v2.5M8.5 5.5L12 3l3.5 2.5" /><rect x="3.5" y="5.5" width="17" height="8" rx="1.5" /><path d="M7 9.5h10M8 13.5L6.5 21M16 13.5l1.5 7.5" /></>,
  window: <><rect x="4.5" y="3.5" width="15" height="15" rx="1.5" /><path d="M12 3.5v15M4.5 11h15M3 20.5h18" /></>,
  floor: <><path d="M3.5 3.5h17v17h-17z" /><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" /><path d="M3.5 3.5h5.7v5.7H3.5zM14.8 3.5h5.7v5.7h-5.7zM9.2 9.2h5.6v5.6H9.2zM3.5 14.8h5.7v5.7H3.5zM14.8 14.8h5.7v5.7h-5.7z" {...S} /></>,
  // Round 10 (B): the staff room (people / heart were already here).
  user: <><circle cx="12" cy="8.5" r="3.8" /><path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0" /></>,
  thumbsUp: <><path d="M7.5 10.5v9.5H4.5v-9.5z" /><path d="M7.5 10.5l3.6-6.3a1.8 1.8 0 0 1 3.3 1.3l-.9 3.7h5a1.8 1.8 0 0 1 1.8 2.1l-1.2 6.8a2 2 0 0 1-2 1.7H7.5" /></>,
  thumbsDown: <><path d="M7.5 13.5V4H4.5v9.5z" /><path d="M7.5 13.5l3.6 6.3a1.8 1.8 0 0 0 3.3-1.3l-.9-3.7h5a1.8 1.8 0 0 0 1.8-2.1l-1.2-6.8a2 2 0 0 0-2-1.7H7.5" /></>,
  graduation: <><path d="M2.5 9.5L12 5l9.5 4.5L12 14z" /><path d="M6.5 11.5v4.2c1.4 1.5 3.3 2.3 5.5 2.3s4.1-.8 5.5-2.3v-4.2M21.5 9.5v5" /></>,
  bolt: <path d="M13.5 3L5.5 13.5h6L10.5 21l8-10.5h-6z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export const isIconName = (s: string | undefined): s is IconName => !!s && Object.prototype.hasOwnProperty.call(ICONS, s);

interface Props {
  name: IconName;
  /** CSS px; default 24 (the grid). Use 20 inside buttons and chips, 28–32 in badges. */
  size?: number;
  /** A label makes the icon meaningful (role="img" + <title>); without one it is decorative and hidden. */
  title?: string;
  className?: string;
}

export function Icon({ name, size = 24, title, className }: Props) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true as const, focusable: "false" as const };
  return (
    <svg
      className={`icon icon--${name}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  );
}

/**
 * A button label that ends "… →" (older callers pass strings like "Next day →"): the words, then a drawn arrow.
 * The arrow is decorative, so the button's name is just the words.
 */
export function ArrowLabel({ text, back = false }: { text: string; back?: boolean }) {
  const m = /^(.*?)\s*→$/.exec(text);
  if (!m && !back) return <>{text}</>;
  return back ? <><Icon name="back" size={20} />{text}</> : <><span>{m![1]}</span><Icon name="forward" size={22} className="icon--go" /></>;
}
