import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Round 8 (B): the panel pattern. A card with one header row — title, an optional subtitle in soft ink, and an
 * optional action pushed to the right — over a hairline, then the body. Uses the long-standing `.card` /
 * `.card__title` classes so older cards and new ones look the same.
 */
export function Panel({ title, sub, action, icon, children, className, as: Tag = "section", headingLevel = 3 }: {
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <Tag className={`card panel${className ? ` ${className}` : ""}`}>
      <div className="card__title">
        <H className="panel__title">{icon && <Icon name={icon} size={22} className="panel__icon" />}{title}</H>
        {sub !== undefined && <span className="card__sub small">{sub}</span>}
        {action && <span className="panel__action">{action}</span>}
      </div>
      {children}
    </Tag>
  );
}

/**
 * A stat tile: a small sentence-case label above, the number big (tabular figures), and an optional delta chip that
 * says which way it went in words as well as colour ("▲ 3 this hour" is never colour alone).
 */
export function StatTile({ label, value, delta, className }: {
  label: ReactNode;
  value: ReactNode;
  delta?: { text: ReactNode; dir: "up" | "down" | "flat"; good?: "up" | "down" } | undefined;
  className?: string;
}) {
  const tone = !delta || delta.dir === "flat" ? "flat" : delta.good ? (delta.dir === delta.good ? "up" : "down") : delta.dir;
  return (
    <div className={`kpi stat-tile${className ? ` ${className}` : ""}`}>
      <div className="kpi__k">{label}</div>
      <div className="kpi__v">{value}</div>
      {delta && (
        <span className={`chip chip--${tone} stat-tile__delta`}>
          {delta.dir !== "flat" && <Icon name={delta.dir === "up" ? "trendUp" : "trendDown"} size={16} />}
          {delta.text}
        </span>
      )}
    </div>
  );
}
