import { useState } from 'react'

export function useDeleteConfirmation<T>() {
  const [target, setTarget] = useState<T | null>(null)

  return {
    deleteTarget: target,
    requestDelete: setTarget,
    clearDelete: () => setTarget(null),
  }
}
