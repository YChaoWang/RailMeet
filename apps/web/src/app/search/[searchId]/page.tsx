import { SearchStatusPage } from '@/components/search/search-status-page';

type PageProps = {
  readonly params: Promise<{ searchId: string }>;
};

export default async function SearchDetailPage({ params }: PageProps) {
  const { searchId } = await params;
  return <SearchStatusPage searchId={searchId} />;
}
