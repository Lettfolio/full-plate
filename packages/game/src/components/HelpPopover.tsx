import { usePopover } from "../lib/usePopover";

const STEPS: { title: string; body: string }[] = [
  { title: "Pick a menu", body: "Menu tab → \"Use a suggested starter menu\", or add 6–8 dishes yourself. Mains matter most." },
  { title: "Hire a chef and a server", body: "Staff tab. Without them you cook and serve yourself: slow food, grumpy guests." },
  { title: "Open for service", body: "Watch the floor. When a problem pops up on the right, pick what to do before the bar runs out." },
  { title: "Restock every evening", body: "Deliveries arrive the next morning, so order tonight for tomorrow (one button on the evening screen)." },
  { title: "Check the rota and the queue", body: "Give your team days off, and if lots of people walk out, buy another table." },
];

/** "What do I do?" — the first week in five steps (Planning). */
export function HelpPopover() {
  const { open, setOpen, root } = usePopover();
  return (
    <div className="popwrap" ref={root}>
      <button className="btn btn--ghost btn--tap" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <span aria-hidden="true">❓</span> What do I do?
      </button>
      {open && (
        <div className="popover popover--right help" role="dialog" aria-label="Your first week">
          <h4>Your first week</h4>
          <ol className="help__steps">
            {STEPS.map((s) => <li key={s.title}><b>{s.title}.</b> <span className="muted">{s.body}</span></li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
