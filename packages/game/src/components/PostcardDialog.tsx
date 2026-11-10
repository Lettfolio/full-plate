import { useEffect, useState } from "react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { makePostcard, offerPng, postcardFileName, type PostcardSize } from "../lib/postcard";
import { MENU_NAMES, useBrand } from "../lib/brand";
import "../screens/planning/BrandTab.css";

/**
 * Round 12 (B): "Postcard" — a preview of tonight's card (landscape 1200×630 or portrait 1080×1350) and "Save
 * postcard", which offers the PNG through the save-file path. The layout follows the brand's menu style.
 */
export function PostcardDialog({ game, result, onClose }: { game: GameState; result?: DayResult | null | undefined; onClose: () => void }) {
  const brand = useBrand();
  const [size, setSize] = useState<PostcardSize>("landscape");
  const [card, setCard] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    let live = true;
    setCard(null); setNote("");
    void makePostcard(game, size, result, brand ?? undefined).then((canvas) => {
      if (!live) return;
      let url = "";
      try { url = canvas.toDataURL("image/png"); } catch { /* no preview, can still try to save */ }
      setCard({ canvas, url });
    });
    return () => { live = false; };
  }, [game, size, result, brand]);
  const save = async () => {
    if (!card) return;
    setNote("Saving…");
    const r = await offerPng(card.canvas, postcardFileName(game.restaurantName, result?.day ?? game.history.at(-1)?.day ?? game.day, size));
    setNote(r === "saved" ? "Postcard saved ✓" : r === "declined" ? "No file was saved." : "Sorry, the postcard couldn't be made.");
  };
  return (
    <Dialog title="Send a postcard" kicker={game.restaurantName} stamp={<Icon name="restaurant" size={28} />} onClose={onClose} wide className="postcard">
      <div className="postcard__bar">
        <div className="seg" role="radiogroup" aria-label="Postcard shape">
          {(["landscape", "portrait"] as const).map((s) => (
            <button key={s} className="seg__opt" role="radio" aria-checked={size === s} onClick={() => setSize(s)}>{s === "landscape" ? "Wide" : "Tall"}</button>
          ))}
        </div>
        <span className="small muted">{brand ? `${MENU_NAMES[brand.menu]} style — change it in Brand` : ""}</span>
      </div>
      <div className={`postcard__preview postcard__preview--${size}`}>
        {card?.url ? <img src={card.url} alt={`Postcard of ${game.restaurantName}`} /> : <div className="postcard__wait small muted">{card ? "Preview not available here — you can still save it." : "Drawing your postcard…"}</div>}
      </div>
      <p className="small muted">Just the restaurant: its name, logo, room and the day's numbers. Nothing about you.</p>
      <div className="postcard__buttons">
        <span className="small" role="status">{note}</span>
        <button className="btn btn--tap" onClick={onClose}>Close</button>
        <button className="btn btn--green btn--tap" data-autofocus disabled={!card} onClick={() => void save()}><Icon name="check" size={20} />Save postcard</button>
      </div>
    </Dialog>
  );
}

/** The button that opens it (Evening, Restaurant tab). */
export function PostcardButton({ game, result, className = "btn btn--sm" }: { game: GameState; result?: DayResult | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`${className} postcard__open`} onClick={() => setOpen(true)}>Postcard</button>
      {open && <PostcardDialog game={game} result={result} onClose={() => setOpen(false)} />}
    </>
  );
}
