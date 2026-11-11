/**
 * Round 8 (maps): the Stars path's own map — the home city's districts with every restaurant in the group pinned.
 *
 * sim-stars has no locations. The flagship sits in the district the game was started in (`game.districtId`); each
 * satellite and the rival get a district from a stable hash of their id / name (`hash32`, FNV-1a), so a restaurant
 * never moves between visits and no randomness is involved. Inspector hints use only what `starsView` may show:
 * the inspection season flag, last guide's revealed visits, and rumours (which include decoys, so they say so).
 */
import type { StarsView } from "@full-plate/sim-stars";
import { extras } from "../../sim";
import { dateLabel } from "../../lib/calendar";
import { CityBoard, MapLegend, districtLabel } from "./mapParts";
import { hash32, LANDS, cityPos } from "./worldGeo";
import { Term } from "../../components/Term";
import { TermText } from "../../components/TermText";

export interface StarsPlace { id: string; name: string; kind: "flagship" | "bar" | "bistro" | "ticketed" | "backed" | "rival"; districtId: string; stars?: number }

const ICON: Record<StarsPlace["kind"], string> = { flagship: "🍽️", bar: "🍸", bistro: "🥖", ticketed: "🎟️", backed: "🤝", rival: "⚔️" };
const KIND: Record<StarsPlace["kind"], string> = { flagship: "your restaurant", bar: "bar", bistro: "bistro", ticketed: "ticketed room", backed: "your old head chef's place", rival: "rival" };

/** The home city: the first city of the home country (Albrenn → Harbourton), or the first city. */
export function homeCity() {
  const home = extras.countries.countries.find((c) => c.home);
  return extras.world.cities.find((c) => c.country === home?.name) ?? extras.world.cities[0]!;
}

/** Every restaurant in the group, plus the rival, each with a district. Deterministic (see the file note). */
export function starsPlaces(v: Pick<StarsView, "satellites" | "rival">, restaurantName: string, homeDistrict: string, districts: readonly string[], shownStars: number): StarsPlace[] {
  const pick = (key: string) => districts[hash32(key) % districts.length]!;
  return [
    { id: "flagship", name: restaurantName, kind: "flagship", districtId: homeDistrict, stars: shownStars },
    ...v.satellites.map((s) => ({ id: s.id, name: s.name, kind: s.kind as StarsPlace["kind"], districtId: pick(s.id) })),
    ...(v.rival ? [{ id: "rival", name: v.rival.name, kind: "rival" as const, districtId: pick(`rival:${v.rival.name}`), stars: v.rival.stars }] : []),
  ];
}

const starRow = (n: number) => <span className="starpin__stars" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className={i < n ? "on" : ""}>{i < n ? "★" : "☆"}</span>)}</span>;

export function StarsMap({ v, restaurantName, districtId, shownStars, day, logo }: { v: StarsView; restaurantName: string; districtId: string; shownStars: number; day: number; /** R13-D: the group's logo on its own restaurants */ logo?: string | undefined }) {
  const city = homeCity();
  const districts = city.districts.includes(districtId) ? city.districts : [districtId, ...city.districts];
  const places = starsPlaces(v, restaurantName, districtId, districts, shownStars);
  const lastGuide = v.guideHistory.at(-1);
  const lastVisits = lastGuide ? v.pastVisits.filter((x) => x.day <= lastGuide.day && x.day > (v.guideHistory.at(-2)?.day ?? -1)).length : 0;
  const rumours = v.rumours.filter((r) => r.day <= day).slice(-2).reverse();
  return (
    <section className="card starsmap stack stack--sm" aria-labelledby="starsmap-h">
      <div className="card__title"><h3 id="starsmap-h">Your restaurants in {city.name}</h3><span className="xs faint">{places.length - (v.rival ? 1 : 0)} in the group{v.rival ? " · 1 rival" : ""}</span></div>
      <div className="starsmap__layout">
        <CityBoard
          cityId={city.id}
          districts={districts}
          costIndex={city.costIndex}
          label={`Map of ${city.name} with your restaurants`}
          tileClass={(d) => (d === districtId && v.inspectionSeason ? "district--season" : "")}
        >
          {(d) => {
            const here = places.filter((p) => p.districtId === d);
            return (
              <>
                {d === districtId && v.inspectionSeason && <span className="district__season">🕵️ Inspectors are about</span>}
                {here.length > 0 ? (
                  <ul className="starpins" aria-label={`Restaurants in ${districtLabel(d)}`}>
                    {here.map((p) => (
                      <li key={p.id} className={`starpin starpin--${p.kind === "flagship" || p.kind === "rival" ? p.kind : "satellite"}`} data-place={p.id}>
                        <span className={`starpin__icon${logo && p.kind !== "rival" ? " starpin__icon--logo" : ""}`} aria-hidden="true">{logo && p.kind !== "rival" ? <img src={logo} width={30} height={30} alt="" /> : ICON[p.kind]}</span>
                        <span className="starpin__text">
                          <span className="starpin__name">{p.name}</span>
                          <span className="starpin__sub">
                            {p.stars !== undefined ? <>{starRow(p.stars)} <span className="sr-only">{p.stars} star{p.stars === 1 ? "" : "s"}, </span></> : null}
                            {KIND[p.kind]}{p.kind !== "flagship" && p.kind !== "rival" ? " · no stars" : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="district__empty">Room for a <Term id="satellite" inline>satellite</Term></p>}
              </>
            );
          }}
        </CityBoard>
        <aside className="starsmap__side" aria-label="Where and who">
          <Locator cityName={city.name} region={extras.world.regions.find((r) => r.id === city.regionId)?.name ?? ""} at={cityPos(city)} />
          <p className="small" style={{ margin: 0 }}>
            {lastGuide ? <>Last guide day ({dateLabel(lastGuide.day)}) inspectors had eaten here <b>{lastVisits}</b> time{lastVisits === 1 ? "" : "s"}.</> : <>No guide day yet. Inspectors never say when they come.</>}
            {" "}This year's visits stay secret until guide day.
          </p>
          {rumours.length > 0 && (
            <div>
              <b className="small">Overheard (might not be true)</b>
              <ul className="starsmap__rumours">{rumours.map((r, i) => <li key={i}>🕵️ {dateLabel(r.day)}: <TermText text={r.text} /></li>)}</ul>
            </div>
          )}
        </aside>
      </div>
      <MapLegend>
        <li className="legend__item"><span className="legend__swatch" aria-hidden="true"><span className="legend__star">★</span></span><span>Golden Plate Guide stars (only your main restaurant and a rival can win them)</span></li>
        <li className="legend__item"><span className="legend__swatch" aria-hidden="true">🍸</span><span><Term id="satellite" inline>Satellites</Term>: bars, bistros and ticketed rooms that earn money, never stars</span></li>
        <li className="legend__item"><span className="legend__swatch" aria-hidden="true">🕵️</span><span>Purple edge = inspection season (an inspector could come any night)</span></li>
      </MapLegend>
    </section>
  );
}

/** A small map of the home region with the city marked; the caption is HTML so it never drops below 13 px. */
function Locator({ cityName, region, at }: { cityName: string; region: string; at: readonly [number, number] }) {
  const near = LANDS.filter((l) => l.regionId === "isles" || l.id === "westland" || l.id === "mainland");
  return (
    <figure className="starsmap__fig">
      <svg className="starsmap__locator" viewBox={`${at[0] - 110} ${at[1] - 150} 220 190`} aria-hidden="true" focusable="false">
        {near.map((l) => <path key={l.id} d={l.d} className="worldmap__land" />)}
        <circle cx={at[0]} cy={at[1]} r="7" className="starsmap__home" />
      </svg>
      <figcaption className="starsmap__cap">📍 {cityName}, {region}</figcaption>
    </figure>
  );
}
