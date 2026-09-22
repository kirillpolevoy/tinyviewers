import Link from 'next/link';
import { LogoFish } from './Art';
import { NAV, SITE_NAME } from '@/lib/copy';
import styles from './SiteHeader.module.css';

type Props = {
  /** Which navigation entry is the page you are on, by href. */
  current?: string;
  /** The analysis pages are the dark register. */
  tone?: 'light' | 'dark';
};

export function SiteHeader({ current, tone = 'light' }: Props) {
  return (
    <header className={`${styles.header} ${tone === 'dark' ? styles.dark : ''}`}>
      <div className={`frame ${styles.inner}`}>
        <Link href="/" className={styles.wordmark}>
          <LogoFish className={styles.fish} />
          <span className={styles.name}>{SITE_NAME}</span>
        </Link>
        <nav aria-label="Main">
          <ul className={styles.nav}>
            {NAV.map((item) => {
              const isCurrent = current === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`${styles.link} ${isCurrent ? styles.currentLink : ''}`}
                    aria-current={isCurrent ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
