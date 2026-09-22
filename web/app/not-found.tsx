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
          <div className={styles.actions}>
            <Link href="/library" className="button">
              {NOT_FOUND.library}
            </Link>
            <Link href="/search" className="button buttonQuiet">
              {NOT_FOUND.search}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
