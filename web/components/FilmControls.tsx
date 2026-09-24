'use client';

import { useState, type MouseEvent, type Ref } from 'react';
import Link from 'next/link';
import { Chevron } from './Art';
import { EMPTY, FILM, STRENGTH_TABLE } from '@/lib/copy';
import { filmHref } from '@/lib/scenes';
import type { AgeBand, Facet } from '@/lib/scenes';
import styles from './FilmControls.module.css';

/**
 * Which age band the strength marks are for. Two links, so it works without JavaScript and the
 * result is a shareable URL; with JavaScript the page recomputes in place instead of navigating.
 * It changes the marks and the counts — never which scenes are listed.
 */
export function AgeToggle({
  slug,
  band,
  selected,
  onChange,
}: {
  slug: string;
  band: AgeBand;
  selected: string[];
  onChange?: (band: AgeBand) => void;
}) {
  const options: { value: AgeBand; label: string }[] = [
    { value: '5-7', label: 'Ages 5–7' },
    { value: '8-10', label: 'Ages 8–10' },
  ];
  return (
    <div className={styles.ageWrap}>
      <span className={styles.ageLabel}>{FILM.ageControlLabel}</span>
      <div className={styles.ageGroup}>
        {options.map((option) => {
          const isCurrent = option.value === band;
          return (
            <Link
              key={option.value}
              href={filmHref(slug, { band: option.value, selected })}
              className={`${styles.ageOption} ${isCurrent ? styles.ageOptionOn : ''}`}
              aria-current={isCurrent ? 'true' : undefined}
              replace
              scroll={false}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                // Only a plain click recomputes in place. Cmd/Ctrl/Shift-click and a middle click
                // keep the link's own meaning: open this band in a new tab or window.
                if (!onChange || isModifiedClick(event)) return;
                event.preventDefault();
                onChange(option.value);
              }}
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** A click the browser gives its own meaning to: new tab, new window, download, middle button. */
export function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/** What the levels mean: a plain disclosure, open and closed with the keyboard, no JavaScript. */
export function LevelsDisclosure() {
  return (
    <details className={styles.levels}>
      <summary className={styles.levelsSummary}>
        <span>{FILM.scaleDisclosure}</span>
        <Chevron />
      </summary>
      <div className={styles.levelsBody}>
        <p className={styles.levelsLead}>{FILM.scaleLead}</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Mark</th>
              <th scope="col">Ages 5–7</th>
              <th scope="col">Ages 8–10</th>
            </tr>
          </thead>
          <tbody>
            {STRENGTH_TABLE.map((row) => (
              <tr key={row.mark}>
                <th scope="row" className={styles.mark}>
                  {row.mark} · {row.word}
                </th>
                <td>{row.band57}</td>
                <td>{row.band810}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.levelsNote}>{FILM.ageFourNote}</p>
        <p className={styles.levelsNote}>
          <b>{EMPTY.notCheckedHeadline}.</b> {EMPTY.notCheckedBody} It is never shown as a zero.
        </p>
      </div>
    </details>
  );
}

/**
 * The filter: one group of chips, "show scenes with any of these", built only from labels that
 * occur in this film, each with the number of scenes it occurs in. A chip applies the moment it is
 * pressed — there is no Apply button. It is still a GET form underneath: without JavaScript a
 * "Show these scenes" button (inside <noscript>, so it never exists for anyone else) puts the
 * selection into the URL and the page renders it server-side, and "Clear filters" is a real link.
 */
export function FilterPanel({
  slug,
  band,
  facets,
  selected,
  onToggle,
  onClear,
  shown,
  total,
  summaryRef,
  onViewMatching,
}: {
  slug: string;
  band: AgeBand;
  facets: Facet[];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  shown: number;
  total: number;
  /** The summary: where focus goes when "Clear filters" takes itself away. */
  summaryRef?: Ref<HTMLElement>;
  /** Bring the filtered list into view (a phone-only button; the list is a screen away there). */
  onViewMatching?: () => void;
}) {
  // Open on arrival when the URL already carries a filter, so the choice stays visible. After that
  // the parent opens and closes it; the prop never changes, so React never overrides them.
  const [openOnArrival] = useState(selected.length > 0);
  return (
    <details className={styles.filters} open={openOnArrival}>
      <summary className={styles.filtersSummary} ref={summaryRef}>
        <span className={styles.filtersTitle}>
          {FILM.filterTitle}
          {selected.length > 0 && FILM.filterOn(selected.length)}
        </span>
        <span className={styles.filtersChevron}>
          <Chevron />
        </span>
      </summary>

      <form
        action={`/film/${slug}`}
        method="get"
        className={styles.filterForm}
        onSubmit={(event) => event.preventDefault()}
      >
        {band !== '5-7' && <input type="hidden" name="age" value={band} />}
        <fieldset className={styles.group}>
          <legend className={`eyebrow ${styles.groupLegend}`}>{FILM.filterLegend}</legend>
          <div className={styles.chips}>
            {facets.map((facet) => (
              <label key={facet.id} className={styles.chip}>
                <input
                  type="checkbox"
                  name="tag"
                  value={facet.id}
                  checked={selected.includes(facet.id)}
                  onChange={() => onToggle(facet.id)}
                  className={styles.checkbox}
                />
                <span>{facet.label}</span>
                <b className={styles.chipCount}>{facet.count}</b>
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.filterActions}>
          <span className={styles.count} aria-live="polite">
            {FILM.filterShowing(shown, total)}
          </span>
          {selected.length > 0 && (
            <Link
              href={filmHref(slug, { band, selected: [] })}
              className={styles.clear}
              replace
              scroll={false}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (isModifiedClick(event)) return;
                event.preventDefault();
                onClear();
              }}
            >
              {FILM.clearFilters}
            </Link>
          )}
          {selected.length > 0 && shown > 0 && onViewMatching && (
            <button type="button" className={`button buttonQuiet ${styles.viewMatching}`} onClick={onViewMatching}>
              {FILM.viewMatching(shown)}
            </button>
          )}
        </div>
        {/* Chips apply on press, which takes JavaScript. Without it, this is how they apply. */}
        <noscript>
          <button type="submit" className={`button buttonQuiet ${styles.noscriptSubmit}`}>
            {FILM.filterApplyNoScript}
          </button>
        </noscript>
      </form>
    </details>
  );
}
