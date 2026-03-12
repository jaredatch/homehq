export default function TopBar() {
  return (
    <header className="flex items-center justify-between border-b border-gray-800 px-6 py-3">
      <div className="flex items-center gap-4">
        {/* Clock component — Phase 5 */}
        <span className="text-lg text-gray-500">Clock</span>
      </div>
      <div className="flex items-center gap-4">
        {/* Weather component — Phase 5 */}
        <span className="text-lg text-gray-500">Weather</span>
      </div>
    </header>
  );
}
