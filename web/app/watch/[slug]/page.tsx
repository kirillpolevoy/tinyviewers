import { redirect } from 'next/navigation';

/**
 * This was a film's recorded Jev run. Recorded runs are retired — every run on /watch is live — so a
 * link to one lands on the page where a live run is started.
 */
export default function RetiredRecordingPage() {
  redirect('/watch');
}
