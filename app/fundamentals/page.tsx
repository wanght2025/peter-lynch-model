import { FundamentalsWorkbench } from '@/components/fundamentals-workbench';

export default async function FundamentalsPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <FundamentalsWorkbench initialCode={code} />;
}
