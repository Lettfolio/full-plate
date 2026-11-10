import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import type { ScreenWord } from "./WordsSheet";

/** Round 11 (D, U9): the words sheet's dialog (lazy chunk; WordsSheet.tsx listens for "?" and opens it). */
export function WordsDialog({ words, onClose }: { words: ScreenWord[]; onClose: () => void }) {
  return (
    <Dialog title="What the words mean" kicker="On this screen" stamp={<Icon name="info" size={28} />} onClose={onClose}>
      {words.length ? (
        <dl className="words">
          {words.map((w) => (
            <div key={w.tip} className="words__row"><dt>{w.label}</dt><dd>{w.tip}</dd></div>
          ))}
        </dl>
      ) : <p className="small muted">No special words on this screen.</p>}
      <p className="xs muted">Tip: press <kbd>?</kbd> any time to open this list.</p>
    </Dialog>
  );
}
