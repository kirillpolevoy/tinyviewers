import { SearchIcon } from './Art';
import styles from './SearchForm.module.css';

type Props = {
  label: string;
  placeholder: string
  button: string;
  defaultValue?: string;
  /** The hero field on Home is larger; every other page uses the compact one. */
  size?: 'hero' | 'compact';
  id?: string;
};

/**
 * A plain GET form to /search: it works with the keyboard, with a screen reader, and with no
 * JavaScript at all. Search is by movie name only — there is no IMDb field anywhere.
 */
export function SearchForm({
  label,
  placeholder,
  button,
  defaultValue = '',
  size = 'compact',
  id = 'movie-title',
}: Props) {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      className={`${styles.form} ${size === 'hero' ? styles.hero : ''}`}
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
            defaultValue={defaultValue}
            placeholder={placeholder}
            autoComplete="off"
            enterKeyHint="search"
          />
        </span>
        <button type="submit" className={`button ${styles.submit}`}>
          {button}
        </button>
      </div>
    </form>
  );
}
