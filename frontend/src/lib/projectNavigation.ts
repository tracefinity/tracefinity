export function projectScopedHref(projectId: string, path: string) {
  return `${path}?from=project&projectId=${projectId}`
}
