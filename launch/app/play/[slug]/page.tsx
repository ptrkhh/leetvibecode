import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Play } from '@/components/Play';
import { CHALLENGES, getChallenge, loadFiles } from '@/lib/challenges';

type Props = { params: Promise<{ slug: string }> };

// Built once per challenge; unknown slugs are a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return CHALLENGES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: getChallenge((await params).slug)?.title };
}

export default async function PlayPage({ params }: Props) {
  const challenge = getChallenge((await params).slug);
  if (!challenge) notFound();
  return <Play challenge={challenge} files={loadFiles(challenge.slug)} />;
}
