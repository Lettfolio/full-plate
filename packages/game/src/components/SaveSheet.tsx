/** Round 9: what the header's save mark means, with Save to a file (a lazy chunk; SaveIndicator.tsx opens it). */
import { useState } from "react";
import type { CloudOffReason } from "../state/saveStore";
import type { SaveMark } from "../state/useSaves";
import { Dialog } from "./Dialog";
import { Icon, type IconName } from "./Icon";

/** One line on what "saved" means right now. */
export function saveExplain(mark: SaveMark, reason?: CloudOffReason): string {
  if (mark === "account") return "Your game is kept in your Claude account, so it's there next time — on any device where you're signed in.";
  if (mark === "saving") return "It's already saved on this device, and it's on its way to your account.";
  if (mark === "memory") return "This browser won't let the game keep a save, so it will be gone when you close it. Use Save to a file to keep it.";
  if (mark === "failed") return "Something in this game couldn't be written down, so the last save didn't happen. Keep playing: it tries again at the next save. Save to a file to keep a copy.";
  if (reason === "slot") return "Saved on this device only — your account can't take this game (it's too big), so it stays here. Your other games still go to your account. Save to a file to keep a copy.";
  if (reason === "signed-out") return "Saved on this device only — sign in to keep it everywhere.";
  if (reason === "full") return "Saved on this device only — your account has no room for more saves. Delete an old game to make room.";
  if (reason === "refused" || reason === "error") return "Saved on this device only — your account didn't take the save this time. Save to a file to keep a copy.";
  return "Saved on this device only. Play inside the Claude app while signed in to keep it everywhere, or use Save to a file.";
}

export function SaveSheet({ mark, reason, title, icon, onFile, onClose }: { mark: SaveMark; reason?: CloudOffReason | undefined; title: string; icon: IconName; onFile: () => Promise<"saved" | "declined" | "failed">; onClose: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const toFile = async () => {
    setFile("Getting the file ready…");
    const r = await onFile();
    setFile(r === "saved" ? "Saved to a file ✓" : r === "declined" ? "No file was saved." : "Sorry, the file couldn't be made.");
  };
  return (
    <Dialog title={title} kicker="Your save" stamp={<Icon name={icon} size={28} />} onClose={onClose} className="savemark__sheet">
      <p>{saveExplain(mark, reason)}</p>
      <div className="row row--wrap">
        <button className="btn btn--tap" onClick={() => void toFile()}><Icon name="download" size={20} />Save to a file</button>
        <button className="btn btn--primary btn--tap" onClick={onClose} data-autofocus>OK</button>
      </div>
      {file && <p className="small" role="status">{file}</p>}
    </Dialog>
  );
}
