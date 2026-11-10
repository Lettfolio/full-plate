import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

/** A town of little shops, each with a pin: the Empire path. Original art, decorative. */
export function EmpirePicture({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 110" aria-hidden="true">
      <rect x="4" y="8" width="152" height="96" rx="14" fill="#dfeef7" />
      <path d="M18 70 q20 -34 58 -26 q30 6 22 34 q-8 22 -44 20 q-40 -2 -36 -28z" fill="#e2f0dc" stroke="#d4c19c" strokeWidth="2" />
      <path d="M100 40 q24 -18 44 0 q12 14 -2 30 q-18 14 -36 2 q-14 -14 -6 -32z" fill="#e2f0dc" stroke="#d4c19c" strokeWidth="2" />
      {[[44, 58], [70, 74], [118, 46], [132, 66], [56, 86]].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <path d="M0 0 c-7 -8 -9 -12 -9 -16 a9 9 0 0 1 18 0 c0 4 -2 8 -9 16z" fill={i % 2 ? "#e9a23b" : "#c4412b"} stroke="#2b2622" strokeWidth="2" />
          <circle cy="-16" r="3.5" fill="#fffdf8" />
        </g>
      ))}
      <g transform="translate(96 92)">
        <path d="M-16 0 h32 a4 4 0 0 1 -4 6 h-24 a4 4 0 0 1 -4 -6z" fill="#c99a63" stroke="#2b2622" strokeWidth="2" />
        <rect x="-17" y="-5" width="34" height="5" rx="2" fill="#3c7a37" stroke="#2b2622" strokeWidth="2" />
        <path d="M-16 -5 a16 11 0 0 1 32 0z" fill="#e9a23b" stroke="#2b2622" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** A plate under a lifted cloche with three stars above: the Stars path. Original art, decorative. */
export function StarsPicture({ className }: { className?: string }) {
  const star = "M0 -9 L2.6 -2.8 L9 -2.8 L3.8 1.2 L5.6 7.6 L0 3.8 L-5.6 7.6 L-3.8 1.2 L-9 -2.8 L-2.6 -2.8z";
  return (
    <svg className={className} viewBox="0 0 160 110" aria-hidden="true">
      <rect x="4" y="8" width="152" height="96" rx="14" fill="#efe3f3" />
      {[50, 80, 110].map((x, i) => <path key={x} d={star} transform={`translate(${x} ${i === 1 ? 26 : 32}) scale(1.3)`} fill="#f2b33d" stroke="#c98b1a" strokeWidth="1.5" />)}
      <ellipse cx="80" cy="88" rx="50" ry="9" fill="#fffdf8" stroke="#2b2622" strokeWidth="2.5" />
      <path d="M58 82 q22 -14 44 0" fill="#c4412b" stroke="#2b2622" strokeWidth="2" />
      <path d="M86 78 q6 -10 14 -8" stroke="#3c7a37" strokeWidth="3" fill="none" strokeLinecap="round" />
      <g transform="rotate(-24 128 60)">
        <path d="M100 64 a28 22 0 0 1 56 0z" fill="#e6d8bd" stroke="#2b2622" strokeWidth="2.5" />
        <circle cx="128" cy="40" r="4" fill="#2b2622" />
      </g>
    </svg>
  );
}

const PATHS = [
  {
    id: "empire",
    name: "Be everywhere",
    who: "The franchise way",
    Picture: EmpirePicture,
    lines: [
      "Copy your restaurant into shops all over the world map.",
      "Let other people run some of them, and keep them happy.",
      "You win when a billion meals are served, or every region knows your name.",
    ],
  },
  {
    id: "stars",
    name: "Be the best",
    who: "The star chef way",
    Picture: StarsPicture,
    lines: [
      "Make one restaurant so good that secret inspectors notice.",
      "Every night counts: cook well, every single night.",
      "You win with three stars for five years, or by closing at the very top.",
    ],
  },
] as const;

/**
 * Round 7: "How do I win?" — the two end-games in pictures and three lines each, reachable from the title screen and
 * from the fork card. Nothing here reads the game state.
 */
export function GoalExplainer({ onClose, atFork = false }: { onClose: () => void; atFork?: boolean }) {
  return (
    <Dialog title="How do I win?" kicker="Two ways to win" stamp={<Icon name="trophy" size={28} />} onClose={onClose} wide className="goals-explain">
      <p className="goals-explain__first">
        {atFork
          ? "You've run your restaurant for a whole year. Now you pick one of two dreams:"
          : "First, run your own restaurant for a whole year and make it a success. Then two visitors come with two big dreams, and you pick one:"}
      </p>
      <div className="goals-explain__paths">
        {PATHS.map(({ id, name, who, Picture, lines }) => (
          <section key={id} className={`goals-explain__path goals-explain__path--${id}`} aria-label={name}>
            <Picture className="goals-explain__pic" />
            <h3>{name}</h3>
            <div className="small muted">{who}</div>
            <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </section>
        ))}
      </div>
      {/* Round 11 (D, U10): the honest length, so nobody expects the fork after one evening. */}
      <p className="small goals-explain__time">
        <b>How long does it take?</b> The first year is 365 days in the game. A day takes about a minute if you play
        at 4× or tap Skip to evening, so the big choice comes after about 3 to 6 hours of playing in all. Short
        sessions are fine: your game saves itself every morning and evening.
      </p>
      <button className="btn btn--primary btn--tap goals-explain__ok" data-autofocus onClick={onClose}>Got it</button>
    </Dialog>
  );
}
