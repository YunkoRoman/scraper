// client/src/components/TaskDetailPage.tsx
interface Props {
  runId: string
  taskId: string
  onBack: () => void
}
export function TaskDetailPage({ runId, taskId, onBack }: Props) {
  void onBack
  return <div className="p-6 text-gray-500">TaskDetailPage — {runId} / {taskId}</div>
}
