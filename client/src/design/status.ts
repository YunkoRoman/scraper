// client/src/design/status.ts

// Parser-level status (used in ParserCard, StatusDot, StatusBadge)
export const PARSER_STATUS = {
  idle: {
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    dot:   'bg-gray-300 dark:bg-gray-500',
    label: 'Idle',
    pulse: false,
  },
  running: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    dot:   'bg-amber-400',
    label: 'Running',
    pulse: true,
  },
  stopped: {
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    dot:   'bg-orange-400',
    label: 'Stopped',
    pulse: false,
  },
  complete: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    dot:   'bg-emerald-400',
    label: 'Complete',
    pulse: false,
  },
  error: {
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    dot:   'bg-rose-400',
    label: 'Error',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; dot: string; label: string; pulse: boolean }>

// Job-level status (used in JobsPage)
export const JOB_STATUS = {
  running: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    label: 'Running',
    pulse: true,
  },
  stopped: {
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    label: 'Stopped',
    pulse: false,
  },
  completed: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    label: 'Completed',
    pulse: false,
  },
  failed: {
    badge: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400',
    label: 'Failed',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; label: string; pulse: boolean }>

// Task-level state (used in JobDetailPage, TaskDetailPage)
export const TASK_STATE = {
  pending: {
    badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    label: 'Pending',
    pulse: false,
  },
  in_progress: {
    badge: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
    label: 'In Progress',
    pulse: true,
  },
  retry: {
    badge: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    label: 'Retry',
    pulse: false,
  },
  success: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    label: 'Success',
    pulse: false,
  },
  failed: {
    badge: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400',
    label: 'Failed',
    pulse: false,
  },
  aborted: {
    badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    label: 'Aborted',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; label: string; pulse: boolean }>

// Fallback for unknown status keys
export const UNKNOWN_STATUS = {
  badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  dot:   'bg-gray-300 dark:bg-gray-500',
  label: 'Unknown',
  pulse: false,
}
