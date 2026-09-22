import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { Bubbles } from '@/components/Art';
import { NOT_FOUND } from '@/lib/copy';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <div className="page">
      <SiteHeader />
      <main className={`frame ${styles.main}`}>
        <div className={styles.card}>
          <Bubbles className={styles.art} />
          <h1 className={styles.headline}>{NOT_FOUND.headline}</h1>
          <p className={styles.body}>{NOT_FOUND.body}</p>
          {/* One way out, because there is one place to go: the library is both the shelf and the
              search. A second button to the same page would only be a second name for it. */}
          <div className={styles.actions}>
            <Link href="/library" className="button">
              {NOT_FOUND.library}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
