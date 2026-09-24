'use client';

import type { FormEvent } from 'react';
import { SearchIcon } from './Art';
import styles from './SearchForm.module.css';

type Props = {
  label: string;
  placeholder: string;
  /** The submit button's words. The library's field has none: it filters as a parent types. */
  button?: string;
  defaultValue?: string;
  /** The hero field on Home is larger; every other page uses the compact one. */
  size?: 'hero' | 'compact';
  id?: string;
  /** Controlled mode, for the library's live filter. Leave out for a plain GET form. */
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  /** The live count line under the field ("5 films", "No film matches"), read out politely. */
  count?: string;
};

/**
 * A plain GET form to /library: it works with the keyboard, with a screen reader, and with no
 * JavaScript at all. Search is by movie name only — there is no IMDb field anywhere.
 *
 * The library answers `?q=`: it opens the film when the query names exactly one, and otherwise
 * shows the library filtered down to what matched. So this form needs no page of its own. On the
 * library itself the same form is controlled, filters as the parent types, and carries its count.
 */
export function SearchForm({
  label,
  placeholder,
  button,
  defaultValue = '',
  size = 'compact',
  id = 'movie-title',
  value,
  onChange,
  onSubmit,
  count,
}: Props) {
  const controlled = value !== undefined;
  return (
    <form
      action="/library"
      method="get"
      role="search"
      className={`${styles.form} ${size === 'hero' ? styles.hero : ''} ${button ? '' : styles.bare}`}
      onSubmit={onSubmit}
    >
      <label className={`eyebrow ${styles.label}`} htmlFor={id}>
        {label}
      </label>
      <div className={styles.row}>
        <span className={styles.field}>
          <SearchIcon className={styles.icon} />
          <input
            id={id}
            className={styles.input}
            type="search"
            name="q"
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="search"
            {...(controlled
              ? { value, onChange: (event) => onChange?.(event.target.value) }
              : { defaultValue })}
          />
        </span>
        {button && (
          <button type="submit" className={`button ${styles.submit}`}>
            {button}
          </button>
        )}
      </div>
      {/* Sighted parents see the list shrink; this says the same thing to a screen reader, and it
          is polite so it waits for a pause in typing rather than interrupting every letter. */}
      {count !== undefined && (
        <p className={styles.count} aria-live="polite">
          {count}
        </p>
      )}
    </form>
  );
}
