'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ImageUploader } from '@/components/ImageUploader'
import { ConfirmModal } from '@/components/ConfirmModal'
import { uploadImage, listSessions, deleteSession, renameSession, getImageUrl } from '@/lib/api'
import type { SessionSummary } from '@/types'
import { Trash2, Edit2, Check, X, Package, Clock, Grid, List, Square, CheckSquare, Loader2, Upload } from 'lucide-react'
import { Alert } from '@/components/Alert'

type ViewMode = 'grid' | 'table'

export default function HomePage() {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<{ ids: string[] } | null>(null)

  useEffect(() => {
    loadSessions()
  }, [])

  async function loadSessions() {
    try {
      const list = await listSessions()
      setSessions(list)
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false)
    }
  }

  async function handleUpload(file: File) {
    setUploading(true)
    setError(null)

    try {
      const result = await uploadImage(file)
      router.push(`/trace/${result.session_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setUploading(false)
    }
  }

  function handleDeleteClick(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteModal({ ids: [id] })
  }

  function handleBulkDeleteClick() {
    if (selected.size === 0) return
    setDeleteModal({ ids: Array.from(selected) })
  }

  async function confirmDelete() {
    if (!deleteModal) return
    const { ids } = deleteModal

    try {
      await Promise.all(ids.map(id => deleteSession(id)))
      setSessions(prev => prev.filter(s => !ids.includes(s.id)))
      setSelected(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    } catch {
      // ignore
    }
    setDeleteModal(null)
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleSelectAll() {
    if (selected.size === sessions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sessions.map(s => s.id)))
    }
  }

  function startEdit(session: SessionSummary, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(session.id)
    setEditName(session.name || '')
  }

  async function saveEdit(e: React.MouseEvent) {
    e.stopPropagation()
    if (!editingId) return

    try {
      await renameSession(editingId, editName)
      setSessions(prev => prev.map(s =>
        s.id === editingId ? { ...s, name: editName || null } : s
      ))
    } catch {
      // ignore
    }
    setEditingId(null)
  }

  function cancelEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(null)
  }

  function formatDate(iso: string | null) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getSessionUrl(session: SessionSummary) {
    if (session.tool_count > 0) {
      return `/configure/${session.id}`
    }
    return `/trace/${session.id}`
  }

  const allSelected = sessions.length > 0 && selected.size === sessions.length

  return (
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Create gridfinity bins from photos
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          Take a photo of your tools on A4 or Letter paper, and we'll generate a custom 3D printable bin.
        </p>
      </div>

      <ImageUploader onUpload={handleUpload} disabled={uploading} />

      {uploading && (
        <div className="flex items-center justify-center gap-2 text-gray-600 dark:text-gray-400 mt-4">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Uploading...</span>
        </div>
      )}

      {error && (
        <div className="max-w-md mx-auto mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* sessions list */}
      {sessions.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-900 dark:text-gray-100">Your Sessions</h3>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button
                  onClick={handleBulkDeleteClick}
                  className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {selected.size}
                </button>
              )}
              <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                  title="Grid view"
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded ${viewMode === 'table' ? 'bg-white dark:bg-gray-700 shadow-sm' : 'hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                  title="Table view"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map(session => (
                <div
                  key={session.id}
                  onClick={() => router.push(getSessionUrl(session))}
                  className={`bg-white dark:bg-gray-800 border rounded-lg overflow-hidden cursor-pointer hover:shadow-sm transition-all ${
                    selected.has(session.id) ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {/* thumbnail */}
                  <div className="aspect-video bg-gray-100 dark:bg-gray-700 relative">
                    {session.thumbnail_url ? (
                      <img
                        src={getImageUrl(session.thumbnail_url)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
                        <Package className="w-8 h-8" />
                      </div>
                    )}
                    {/* select checkbox */}
                    <button
                      onClick={e => toggleSelect(session.id, e)}
                      className="absolute top-2 left-2 p-1 bg-white/90 dark:bg-gray-800/90 rounded hover:bg-white dark:hover:bg-gray-800"
                    >
                      {selected.has(session.id) ? (
                        <CheckSquare className="w-5 h-5 text-blue-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                      )}
                    </button>
                    {session.has_stl && (
                      <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded">
                        STL
                      </div>
                    )}
                  </div>

                  {/* info */}
                  <div className="p-3">
                    {editingId === session.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="Session name"
                          autoFocus
                        />
                        <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {session.name || `Session ${session.id.slice(0, 8)}`}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(session.created_at)}
                            {session.tool_count > 0 && (
                              <span className="ml-2">{session.tool_count} tool{session.tool_count !== 1 ? 's' : ''}</span>
                            )}
                          </p>
                          {session.tags && session.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {session.tags.slice(0, 3).map((tag) => (
                                <span
                                  key={tag}
                                  className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                              {session.tags.length > 3 && (
                                <span className="text-xs text-gray-400">+{session.tags.length - 3}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={e => startEdit(session, e)}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={e => handleDeleteClick(session.id, e)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <button onClick={toggleSelectAll} className="p-0.5">
                        {allSelected ? (
                          <CheckSquare className="w-5 h-5 text-blue-600" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                    </th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase px-4 py-3">Name</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase px-4 py-3">Tags</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase px-4 py-3">Created</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase px-4 py-3">Tools</th>
                    <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase px-4 py-3">Status</th>
                    <th className="w-24 px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {sessions.map(session => (
                    <tr
                      key={session.id}
                      onClick={() => router.push(getSessionUrl(session))}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                        selected.has(session.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <button onClick={e => toggleSelect(session.id, e)} className="p-0.5">
                          {selected.has(session.id) ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {editingId === session.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                              placeholder="Session name"
                              autoFocus
                            />
                            <button onClick={saveEdit} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                              <Check className="w-4 h-4" />
                            </button>
                            <button onClick={cancelEdit} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {session.name || `Session ${session.id.slice(0, 8)}`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {session.tags && session.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {session.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded"
                              >
                                {tag}
                              </span>
                            ))}
                            {session.tags.length > 2 && (
                              <span className="text-xs text-gray-400">+{session.tags.length - 2}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(session.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {session.tool_count > 0 ? session.tool_count : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {session.has_stl ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                            STL Ready
                          </span>
                        ) : session.tool_count > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                            Traced
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={e => startEdit(session, e)}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={e => handleDeleteClick(session.id, e)}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loadingSessions && sessions.length === 0 && (
        <div className="mt-12 max-w-lg mx-auto">
          <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-4">How it works</h3>
          <ol className="space-y-3">
            {[
              'Place your tools on a sheet of A4 or Letter paper',
              'Take a photo from above',
              'Upload the photo and adjust the paper corners',
              'Let AI trace the tool outlines',
              'Configure your gridfinity bin dimensions',
              'Download the STL for 3D printing',
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-sm font-medium flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300 pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* delete confirmation modal */}
      <ConfirmModal
        open={deleteModal !== null}
        title={deleteModal?.ids.length === 1 ? 'Delete session?' : `Delete ${deleteModal?.ids.length} sessions?`}
        message={
          deleteModal?.ids.length === 1
            ? 'This will permanently delete the session and all associated files.'
            : `This will permanently delete ${deleteModal?.ids.length} sessions and all associated files.`
        }
        confirmText="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteModal(null)}
      />
    </div>
  )
}
