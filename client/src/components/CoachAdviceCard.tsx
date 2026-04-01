export function CoachAdviceCard({ advice }: { advice: string | null }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="mb-2 text-sm font-semibold text-gray-900">Coach Advice</div>
      <p className="text-sm leading-6 text-gray-600">
        {advice ?? "還沒記錄任何餐點，開始記錄你的第一餐吧"}
      </p>
    </section>
  );
}
