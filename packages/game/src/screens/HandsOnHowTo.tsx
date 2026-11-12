import type { ReactNode } from "react";
import type { HandsOnRole } from "@full-plate/handson";
import { Term } from "../components/Term";
import type { HandsOnLayout } from "./handsonPhone";
import { useRotateCardUp } from "../components/RotateCard";

/**
 * Round 13 (C): the first-shift how-to on a phone — three cards that fit a 390 px-high screen (one short paragraph
 * each, no spotlight to chase round a small kitchen), skippable, shown once per role on this device and then never
 * again (the "?" button brings it back). It replaces the R7 spotlight steps on a phone; a laptop keeps those.
 */
export interface HowToCard { title: string; body: ReactNode }

export function phoneHowToCards(role: HandsOnRole, layout: Exclude<HandsOnLayout, "desk">, station?: { label: string }): HowToCard[] {
  const where = layout === "upright" ? "the pad under the kitchen" : "the kitchen";
  const use = layout === "upright" ? "USE, bottom right," : "USE, by your right thumb,";
  const drop = layout === "upright" ? "Drop, beside it," : "Drop, by your left thumb,";
  const walk: HowToCard = {
    title: "Walk",
    body: <>Tap a station and you walk to it. Or drag your thumb across {where} to steer: the further you drag, the faster you go.{layout === "upright" ? " The kitchen slides along with you." : ""}</>,
  };
  const job: HowToCard = {
    title: "Do the job",
    body: <>{use} works whatever you're facing. Tap it to grab or chop; hold it to cook or pour, and let go when the needle is in the green. {drop} puts down what you're carrying.</>,
  };
  const goal: HowToCard =
    role === "chef"
      ? {
          title: station ? `Your station: ${station.label}` : "Read the rail",
          body: (
            <>
              The strip along the top is the <Term id="ticketRail" inline>ticket rail</Term>: one slip per table, its bar draining as they wait.
              {station ? " Slips with a red edge are yours, and the appliances marked Yours are your station." : ""} Fetch from the fridge, cook, and plate up at
              the <Term id="pass" inline>pass</Term>. Points, plates and the clock sit top right.
            </>
          ),
        }
      : role === "bar"
        ? {
            title: "Behind the bar",
            body: <>Hold USE at the bar to pour and let go on the dashed line. Carry the drinks to the table on the slip, and take payment at the till when a gold £ shows.</>,
          }
        : {
            title: "On the floor",
            body: (
              <>
                Slips along the top are tables waiting on food. Pick plates up at the <Term id="pass" inline>pass</Term> (three at most), carry them to the
                table on the slip, clear dirty tables, and take payment at the till when a gold £ shows.
              </>
            ),
          };
  return [walk, job, goal];
}

export function HandsOnHowTo({ cards, step, onNext, onSkip }: { cards: HowToCard[]; step: number; onNext: () => void; onSkip: () => void }) {
  const card = cards[step];
  // Round 14 (E, U17): never under the "Turn your phone sideways" card — it goes first, then the how-to.
  const rotating = useRotateCardUp();
  if (!card || rotating) return null;
  const last = step + 1 >= cards.length;
  return (
    <div className="onboard howto" role="dialog" aria-modal="false" aria-labelledby="howto-title">
      <div className="howto__card">
        <div className="howto__head">
          <span className="howto__count">{step + 1} of {cards.length}</span>
          <div className="onboard__steps" aria-hidden="true">
            {cards.map((_, i) => <span key={i} className={`onboard__dot${i === step ? " onboard__dot--on" : ""}`} />)}
          </div>
        </div>
        <h3 id="howto-title">{card.title}</h3>
        <p>{card.body}</p>
        <div className="howto__actions">
          <button className="btn btn--ghost handson__btn" onClick={onSkip}>Skip</button>
          <button className="btn btn--primary handson__btn" onClick={onNext} autoFocus>{last ? "Start the shift" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
