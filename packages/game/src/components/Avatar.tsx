import { memo, useId } from "react";
import { avatarFor, type AvatarSpec, type StaffRole } from "@full-plate/sim-core";
import "./people.css";

/**
 * Round 10 (B): a person's portrait, drawn from sim-core `avatarFor` (or `playerAvatar`) in the handson sprite's style
 * (packages/handson/src/sprites.ts): a round head about 0.64 of the shoulders, one warm outline weight (#3a2c22, ~0.13
 * of the body radius), light from the top-left (a highlight on the left shoulder, shade on the lower right), rosy
 * cheeks and dot eyes. A portrait adds what a 20 px sprite can't: a hair style, glasses, freckles and a mouth that
 * follows mood. The disc behind is the person's favourite colour.
 *
 *   <Avatar person={staff} size={96} mood={staff.mood} />    decorative (aria-hidden); the card names the person
 *   <Avatar spec={playerAvatar(look, role)} size={64} title="You" />
 *
 * viewBox 0 0 100 100; shoulders r = 34 at (50, 103); head r ≈ 24 at (50, 57). Charming at 32 px and 96 px.
 */
const OUT = "#3a2c22";
const SW = 4.4; // ≈ 0.13 × body radius, as the sprite
const BODY_R = 34;

export interface AvatarProps {
  spec?: AvatarSpec;
  person?: { id?: string; name: string; role: StaffRole };
  size?: number;
  /** 0-100: smile, flat or frown. Omitted = a small smile. */
  mood?: number;
  /** Accessible name; omitted = decorative. */
  title?: string;
  className?: string;
  /** Round 12 (B): the house uniform (lib/brandCode.ts uniformPatch) over the person's own clothes. */
  uniform?: Partial<Pick<AvatarSpec, "body" | "apron" | "shirt" | "trim" | "hatColour">> | undefined;
}

function hairBack(s: AvatarSpec, fx: number, fy: number, rx: number, ry: number) {
  // hair behind the head (long, bob): drawn before the face
  if (s.hairStyle === "long") return <path d={`M${fx - rx - 3} ${fy - 4} Q${fx - rx - 6} ${fy + ry + 18} ${fx - rx + 2} ${fy + ry + 20} L${fx + rx - 2} ${fy + ry + 20} Q${fx + rx + 6} ${fy + ry + 18} ${fx + rx + 3} ${fy - 4} Z`} fill={s.hair} stroke={OUT} strokeWidth={SW} strokeLinejoin="round" />;
  if (s.hairStyle === "bob") return <path d={`M${fx - rx - 4} ${fy - 2} Q${fx - rx - 5} ${fy + ry * 0.9} ${fx - rx + 4} ${fy + ry * 0.75} L${fx + rx - 4} ${fy + ry * 0.75} Q${fx + rx + 5} ${fy + ry * 0.9} ${fx + rx + 4} ${fy - 2} Z`} fill={s.hair} stroke={OUT} strokeWidth={SW} strokeLinejoin="round" />;
  if (s.hairStyle === "bun" && s.hat === "none") return <circle cx={fx} cy={fy - ry - 6} r={9} fill={s.hair} stroke={OUT} strokeWidth={SW} />;
  return null;
}

function hairFront(s: AvatarSpec, fx: number, fy: number, rx: number, ry: number) {
  const top = fy - ry;
  switch (s.hairStyle) {
    case "buzz":
      return <path d={`M${fx - rx + 1} ${fy - 6} A${rx - 1} ${ry - 1} 0 0 1 ${fx + rx - 1} ${fy - 6} Q${fx} ${fy - ry * 0.62} ${fx - rx + 1} ${fy - 6} Z`} fill={s.hair} opacity={0.9} />;
    case "spiky":
      return <path d={`M${fx - rx - 1} ${fy - 2} L${fx - rx + 2} ${top + 2} L${fx - 12} ${top - 7} L${fx - 6} ${top + 1} L${fx} ${top - 9} L${fx + 6} ${top + 1} L${fx + 12} ${top - 7} L${fx + rx - 2} ${top + 2} L${fx + rx + 1} ${fy - 2} Q${fx + 6} ${fy - ry * 0.45} ${fx - rx - 1} ${fy - 2} Z`} fill={s.hair} stroke={OUT} strokeWidth={SW} strokeLinejoin="round" />;
    case "curly":
      return (
        <g fill={s.hair} stroke={OUT} strokeWidth={SW}>
          {[-17, -6, 6, 17].map((dx, i) => <circle key={dx} cx={fx + dx} cy={top + 4 + (i === 0 || i === 3 ? 6 : 0)} r={8.5} />)}
          <path d={`M${fx - rx} ${fy - 3} Q${fx} ${fy - ry * 0.55} ${fx + rx} ${fy - 3} L${fx + rx - 2} ${top + 8} L${fx - rx + 2} ${top + 8} Z`} stroke="none" />
        </g>
      );
    default:
      // short / bob / long / bun: the sprite's fringe cap with a side sweep
      return <path d={`M${fx - rx - 1} ${fy - 1} A${rx + 1} ${ry + 1} 0 0 1 ${fx + rx + 1} ${fy - 1} Q${fx + rx * 0.2} ${fy - ry * 0.62} ${fx - rx * 0.35} ${fy - ry * 0.3} Q${fx - rx * 0.75} ${fy - ry * 0.2} ${fx - rx - 1} ${fy - 1} Z`} fill={s.hair} stroke={OUT} strokeWidth={SW} strokeLinejoin="round" />;
  }
}

function hat(s: AvatarSpec, fx: number, fy: number, ry: number) {
  const top = fy - ry;
  if (s.hat === "toque")
    return (
      <g fill={s.hatColour} stroke={OUT} strokeWidth={SW} strokeLinejoin="round">
        <circle cx={fx - 11} cy={top - 5} r={9.5} />
        <circle cx={fx + 11} cy={top - 5} r={9.5} />
        <circle cx={fx} cy={top - 10} r={11} />
        <rect x={fx - 19} y={top - 2} width={38} height={12} rx={2} />
        <rect x={fx - 17.5} y={top + 5} width={35} height={3} fill="rgba(0,0,0,0.07)" stroke="none" />
      </g>
    );
  if (s.hat === "cap")
    return (
      <g fill={s.hatColour} stroke={OUT} strokeWidth={SW} strokeLinejoin="round">
        <path d={`M${fx - 23} ${top + 13} A23 20 0 0 1 ${fx + 23} ${top + 13} Z`} />
        <path d={`M${fx + 4} ${top + 13} Q${fx + 22} ${top + 9} ${fx + 32} ${top + 15} Q${fx + 20} ${top + 18} ${fx + 4} ${top + 15} Z`} />
      </g>
    );
  return null;
}

function mouth(mood: number | undefined, fx: number, my: number) {
  const m = mood ?? 65;
  if (m >= 75) return <path d={`M${fx - 7} ${my - 1} Q${fx} ${my + 8} ${fx + 7} ${my - 1} Z`} fill="#8f3a2c" stroke={OUT} strokeWidth={2.4} strokeLinejoin="round" />;
  if (m >= 50) return <path d={`M${fx - 6} ${my} Q${fx} ${my + 5} ${fx + 6} ${my}`} fill="none" stroke={OUT} strokeWidth={2.8} strokeLinecap="round" />;
  if (m >= 30) return <path d={`M${fx - 5} ${my + 2} L${fx + 5} ${my + 2}`} stroke={OUT} strokeWidth={2.8} strokeLinecap="round" />;
  return <path d={`M${fx - 6} ${my + 4} Q${fx} ${my - 2} ${fx + 6} ${my + 4}`} fill="none" stroke={OUT} strokeWidth={2.8} strokeLinecap="round" />;
}

function AvatarImpl({ spec, person, size = 48, mood, title, className, uniform }: AvatarProps) {
  const uid = useId();
  const base = spec ?? (person ? avatarFor(person) : undefined);
  const s = base && uniform ? { ...base, ...uniform } : base;
  if (!s) return null;
  const cx = 50, by = 103; // shoulders centre
  const fx = 50, fy = 57;
  const [rx, ry] = s.face === "oval" ? [22, 25.5] : s.face === "wide" ? [26, 23] : [24, 24];
  const clip = `av${uid.replace(/:/g, "")}`;
  const eyeY = fy + 2, eyeDx = rx * 0.38;
  const label = title ? { role: "img" as const, "aria-label": title } : { "aria-hidden": true as const };
  return (
    <svg className={`avatarsvg ${className ?? ""}`} width={size} height={size} viewBox="0 0 100 100" {...label} focusable="false">
      {title && <title>{title}</title>}
      <defs>
        <clipPath id={clip}><circle cx="50" cy="50" r="48" /></clipPath>
      </defs>
      <circle cx="50" cy="50" r="48" fill={s.colour.hex} />
      <g clipPath={`url(#${clip})`}>
        <circle cx="34" cy="30" r="34" fill="rgba(255,255,255,0.18)" />
        {hairBack(s, fx, fy, rx, ry)}
        {/* shoulders, shaded like the sprite */}
        <ellipse cx={cx} cy={by} rx={BODY_R} ry={BODY_R * 0.8} fill={s.body} stroke={OUT} strokeWidth={SW} />
        {s.apron && <rect x={cx - 21} y={by - 2} width={42} height={30} fill={s.apron} />}
        {s.shirt && <path d={`M${cx - 11} ${by - 26} L${cx + 11} ${by - 26} L${cx} ${by - 6} Z`} fill="#fbf8f2" />}
        <ellipse cx={cx + 12} cy={by + 8} rx={34} ry={20} fill="rgba(30,15,5,0.14)" />
        <ellipse cx={cx - 15} cy={by - 16} rx={13} ry={6} fill="rgba(255,255,255,0.2)" transform={`rotate(-22 ${cx - 15} ${by - 16})`} />
        <ellipse cx={cx} cy={by} rx={BODY_R} ry={BODY_R * 0.8} fill="none" stroke={OUT} strokeWidth={SW} />
        {s.trim && (
          <g fill={s.trim} stroke={OUT} strokeWidth={1.6} strokeLinejoin="round">
            <path d={`M${cx} ${by - 22} L${cx - 10} ${by - 28} L${cx - 10} ${by - 16} Z`} />
            <path d={`M${cx} ${by - 22} L${cx + 10} ${by - 28} L${cx + 10} ${by - 16} Z`} />
          </g>
        )}
        {/* neck and head */}
        <rect x={fx - 7} y={fy + ry - 6} width={14} height={12} fill={s.skin} />
        <ellipse cx={fx} cy={fy} rx={rx} ry={ry} fill={s.skin} stroke={OUT} strokeWidth={SW} />
        <ellipse cx={fx - rx - 1} cy={fy + 4} rx={4} ry={5.5} fill={s.skin} stroke={OUT} strokeWidth={SW * 0.7} />
        <ellipse cx={fx + rx + 1} cy={fy + 4} rx={4} ry={5.5} fill={s.skin} stroke={OUT} strokeWidth={SW * 0.7} />
        <ellipse cx={fx} cy={fy} rx={rx - 0.5} ry={ry - 0.5} fill={s.skin} />
        {hairFront(s, fx, fy, rx, ry)}
        <ellipse cx={fx} cy={fy} rx={rx} ry={ry} fill="none" stroke={OUT} strokeWidth={SW} />
        {/* face */}
        <circle cx={fx - eyeDx} cy={eyeY} r={3.3} fill={OUT} />
        <circle cx={fx + eyeDx} cy={eyeY} r={3.3} fill={OUT} />
        <circle cx={fx - eyeDx + 1.1} cy={eyeY - 1.2} r={1} fill="#fffdf8" />
        <circle cx={fx + eyeDx + 1.1} cy={eyeY - 1.2} r={1} fill="#fffdf8" />
        <circle cx={fx - rx * 0.6} cy={fy + 11} r={4.4} fill="rgba(226,110,90,0.38)" />
        <circle cx={fx + rx * 0.6} cy={fy + 11} r={4.4} fill="rgba(226,110,90,0.38)" />
        {s.freckles && <g fill="rgba(122,58,34,0.55)">{[[-0.62, 6], [-0.5, 9], [-0.72, 9.5], [0.62, 6], [0.5, 9], [0.72, 9.5]].map(([k, dy]) => <circle key={`${k}${dy}`} cx={fx + rx * k!} cy={fy + dy!} r={1.1} />)}</g>}
        {mouth(mood, fx, fy + 13)}
        {s.glasses && (
          <g fill="rgba(255,255,255,0.25)" stroke={OUT} strokeWidth={2.2}>
            <circle cx={fx - eyeDx} cy={eyeY} r={6.4} />
            <circle cx={fx + eyeDx} cy={eyeY} r={6.4} />
            <path d={`M${fx - eyeDx + 7} ${eyeY} L${fx + eyeDx - 7} ${eyeY}`} fill="none" />
          </g>
        )}
        {hat(s, fx, fy, ry)}
      </g>
      <circle cx="50" cy="50" r="48" fill="none" stroke={OUT} strokeOpacity={0.18} strokeWidth={2} />
    </svg>
  );
}

export const Avatar = memo(AvatarImpl);
