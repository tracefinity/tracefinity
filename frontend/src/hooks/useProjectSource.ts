import { useSearchParams } from 'next/navigation'
import { projectScopedHref } from '@/lib/projectNavigation'

export function useProjectSource(defaultLabel: string, defaultHref = '/') {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('from') === 'project' ? searchParams.get('projectId') : null

  return {
    projectId,
    rootLabel: projectId ? 'Projects' : defaultLabel,
    rootHref: projectId ? `/projects/${projectId}` : defaultHref,
    scopedHref: (path: string) => projectId ? projectScopedHref(projectId, path) : path,
  }
}
