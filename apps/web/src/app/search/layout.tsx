import { PlannerMapProvider } from '@/components/search/planner-map-context';

export default function SearchLayout({ children }: { readonly children: React.ReactNode }) {
  return <PlannerMapProvider>{children}</PlannerMapProvider>;
}
