import Link from 'next/link';
import { Chevron, FilterIcon } from './Art';
import { EMPTY, FILM, STRENGTH_TABLE } from '@/lib/copy';
import { filmHref } from '@/lib/scenes';
import type { AgeBand, Facet } from '@/lib/scenes';
import styles from './FilmControls.module.css';

/**
 * Which age band the single strength mark is for. Two links, so it works without JavaScript and the
 * result is a shareable URL. It changes the mark only — never which scenes are listed.
 */
export function AgeToggle({
  slug,
  band,
  selected,
}: {
  slug: string;
  band: AgeBand;
  selected: string[];
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
            >
              {option.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
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
 * The filters, above the list, folded until asked for (open when a filter is already applied, so
 * the choice stays visible). Built only from labels that occur in this film, each with the number
 * of scenes it occurs in. A GET form: checkboxes, an Apply button, and the selection lives in the
 * URL, so it is shareable and works with JavaScript switched off.
 */
export function FilterPanel({
  slug,
  band,
  presence,
  events,
  selected,
  shown,
  total,
}: {
  slug: string;
  band: AgeBand;
  presence: Facet[];
  events: Facet[];
  selected: string[];
  shown: number;
  total: number;
}) {
  return (
    <details className={styles.filters} open={selected.length > 0}>
      <summary className={styles.filtersSummary}>
        <span className={styles.filtersTitle}>
          <FilterIcon />
          {FILM.filterDisclosure}
        </span>
        <span className={styles.filtersPrompt}>
          {FILM.filterPrompt} {FILM.filterRule}
          <Chevron />
        </span>
      </summary>

      <form action={`/film/${slug}`} method="get" className={styles.filterForm}>
        {band !== '5-7' && <input type="hidden" name="age" value={band} />}
        <div className={styles.groups}>
          <FacetGroup legend={FILM.groupPresence} facets={presence} selected={selected} />
          <FacetGroup legend={FILM.groupEvents} facets={events} selected={selected} />
        </div>
        <div className={styles.filterActions}>
          <button type="submit" className="button buttonQuiet">
            {FILM.applyFilters}
          </button>
          <Link href={filmHref(slug, { band, selected: [] })} className={styles.clear}>
            {FILM.clearFilters}
          </Link>
          <span className={styles.count}>
            Showing {shown} of {total} scenes.
          </span>
        </div>
      </form>
    </details>
  );
}

function FacetGroup({
  legend,
  facets,
  selected,
}: {
  legend: string;
  facets: Facet[];
  selected: string[];
}) {
  if (!facets.length) return null;
  return (
    <fieldset className={styles.group}>
      <legend className={`eyebrow ${styles.groupLegend}`}>{legend}</legend>
      <div className={styles.chips}>
        {facets.map((facet) => {
          // The look of a chip comes from :has(:checked) in CSS and from nothing else. A class
          // computed here would be the URL's opinion, and would stay lit after the box was
          // unticked — telling the parent a filter is on when it is not.
          const isOn = selected.includes(facet.id);
          return (
            <label key={facet.id} className={styles.chip}>
              <input
                type="checkbox"
                name="tag"
                value={facet.id}
                defaultChecked={isOn}
                className={styles.checkbox}
              />
              <span>{facet.label}</span>
              <b className={styles.chipCount}>{facet.count}</b>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
