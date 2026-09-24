import { notFound, redirect } from 'next/navigation';
import { isJobId } from '@/lib/job';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ id: string }> };

/**
 * An add run is shown live inside the library now. This route stays so the links already out there
 * — and the finish offer under a /watch run — still land on the run.
 */
export default async function AddJobPage({ params }: Props) {
  const { id } = await params;
  if (!isJobId(id)) notFound();
  redirect(`/library?job=${encodeURIComponent(id)}`);
}
