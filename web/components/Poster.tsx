import Image from 'next/image';
import { FILM } from '@/lib/copy';
import styles from './Poster.module.css';

type Props = {
  url: string | null;
  title: string;
  /** The box this poster fills, in CSS pixels, so the optimizer is asked for the right size. */
  width: number;
  height: number;
  /** The film page's poster is above the fold; the library's row posters are not. */
  priority?: boolean;
  className?: string;
  /** The placeholder's words. A 56px row poster has room for "to come", not the whole sentence. */
  placeholder?: string;
  /** Inside a link or row that already names the film: the image adds nothing to its name. */
  decorative?: boolean;
};

/**
 * A poster when the loader found one on TMDB, and the design's labelled placeholder when it did
 * not. Nothing is guessed: a missing poster stays missing and says so.
 *
 * next/image, with explicit dimensions, so the host allowlist in next.config.mjs is actually
 * enforced: an image URL from anywhere but image.tmdb.org fails the build-time check instead of
 * being fetched by the browser. The declared width/height give the box its aspect ratio; the CSS
 * for each use decides the real size.
 */
export function Poster({
  url,
  title,
  width,
  height,
  priority = false,
  className = '',
  placeholder = FILM.posterPlaceholder,
  decorative = false,
}: Props) {
  if (!url) {
    return (
      <span className={`posterPlaceholder ${styles.poster} ${className}`} aria-hidden="true">
        {placeholder}
      </span>
    );
  }
  return (
    <Image
      className={`${styles.poster} ${styles.image} ${className}`}
      src={url}
      alt={decorative ? '' : `${title} poster`}
      width={width}
      height={height}
      priority={priority}
      sizes={`${width}px`}
    />
  );
}
