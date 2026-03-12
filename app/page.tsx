import TopBar from '@/components/dashboard/TopBar';

export default function DashboardPage() {
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <main className="flex-1 overflow-hidden p-4">
        {/* Calendar grid — Phase 4 */}
        <div className="flex h-full items-center justify-center text-gray-500">
          Calendar grid coming in Phase 4
        </div>
      </main>
    </div>
  );
}
