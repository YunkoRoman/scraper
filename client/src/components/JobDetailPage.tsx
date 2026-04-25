// client/src/components/JobDetailPage.tsx
interface Props {
  runId: string
  onBack: () => void
  onViewTask: (taskId: string) => void
}
export function JobDetailPage({ runId, onBack, onViewTask }: Props) {
  void onBack
  void onViewTask
  return <div className="p-6 text-gray-500">JobDetailPage — {runId}</div>
}
