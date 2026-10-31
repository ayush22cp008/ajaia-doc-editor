'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  FileText,
  Plus,
  Search,
  Pencil,
  Trash2,
  ExternalLink,
  Users,
  Clock,
  Loader2,
  AlertCircle,
  X,
  FileQuestion,
  Check,
} from 'lucide-react'

export interface DocumentItem {
  id: string
  title: string
  owner_id: string
  created_at: string
  updated_at: string
  role: 'owner' | 'editor' | 'viewer'
  owner_email?: string
}

interface DashboardClientProps {
  initialOwnedDocs: DocumentItem[]
  initialSharedDocs: DocumentItem[]
  userId: string
  userEmail?: string
}

export function DashboardClient({
  initialOwnedDocs,
  initialSharedDocs,
  userId,
}: DashboardClientProps) {
  const router = useRouter()
  const supabase = createClient()

  const [ownedDocs, setOwnedDocs] = useState<DocumentItem[]>(initialOwnedDocs)
  const [sharedDocs, setSharedDocs] = useState<DocumentItem[]>(initialSharedDocs)
  const [activeTab, setActiveTab] = useState<'owned' | 'shared'>('owned')
  const [searchQuery, setSearchQuery] = useState('')

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [createLoading, setCreateLoading] = useState(false)

  const [renameTarget, setRenameTarget] = useState<DocumentItem | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Notification banners
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  function showSuccess(msg: string) {
    setActionSuccess(msg)
    setActionError(null)
    setTimeout(() => {
      setActionSuccess((prev) => (prev === msg ? null : prev))
    }, 4000)
  }

  function showError(msg: string) {
    setActionError(msg)
    setActionSuccess(null)
  }

  // 1. Create Document
  async function handleCreateDocument(e: React.FormEvent) {
    e.preventDefault()
    setActionError(null)
    const title = newTitle.trim() || 'Untitled Document'

    try {
      setCreateLoading(true)
      const { data, error } = await supabase
        .from('documents')
        .insert({
          title,
          owner_id: userId,
          content: { type: 'doc', content: [] },
        })
        .select()
        .single()

      if (error) {
        throw new Error(error.message)
      }

      if (data) {
        const newDoc: DocumentItem = {
          id: data.id,
          title: data.title,
          owner_id: data.owner_id,
          created_at: data.created_at,
          updated_at: data.updated_at,
          role: 'owner',
        }
        setOwnedDocs((prev) => [newDoc, ...prev])
        setIsCreateOpen(false)
        setNewTitle('')
        showSuccess(`"${newDoc.title}" created successfully.`)
        router.refresh()
      }
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Failed to create document.')
    } finally {
      setCreateLoading(false)
    }
  }

  // 2. Rename Document
  async function handleRenameDocument(e: React.FormEvent) {
    e.preventDefault()
    if (!renameTarget) return
    setActionError(null)

    const updatedTitle = renameTitle.trim()
    if (!updatedTitle) {
      showError('Document title cannot be empty.')
      return
    }

    try {
      setRenameLoading(true)
      const { error } = await supabase
        .from('documents')
        .update({ title: updatedTitle })
        .eq('id', renameTarget.id)

      if (error) {
        throw new Error(error.message)
      }

      // Update state in owned or shared list
      setOwnedDocs((prev) =>
        prev.map((d) => (d.id === renameTarget.id ? { ...d, title: updatedTitle } : d))
      )
      setSharedDocs((prev) =>
        prev.map((d) => (d.id === renameTarget.id ? { ...d, title: updatedTitle } : d))
      )

      showSuccess(`Renamed to "${updatedTitle}".`)
      setRenameTarget(null)
      router.refresh()
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Failed to rename document.')
    } finally {
      setRenameLoading(false)
    }
  }

  // 3. Delete Document (Only owned documents)
  async function handleDeleteDocument() {
    if (!deleteTarget) return
    setActionError(null)

    try {
      setDeleteLoading(true)
      const { error } = await supabase.from('documents').delete().eq('id', deleteTarget.id)

      if (error) {
        throw new Error(error.message)
      }

      setOwnedDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      showSuccess(`"${deleteTarget.title}" deleted permanently.`)
      setDeleteTarget(null)
      router.refresh()
    } catch (err: unknown) {
      showError(err instanceof Error ? err.message : 'Failed to delete document.')
    } finally {
      setDeleteLoading(false)
    }
  }

  // Current list filtering
  const currentList = activeTab === 'owned' ? ownedDocs : sharedDocs
  const filteredDocs = currentList.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase().trim())
  )

  function formatDate(iso: string) {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return iso
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
      {/* Alert Banners */}
      {actionError && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 flex items-center justify-between text-sm text-red-700 dark:text-red-300">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 flex items-center justify-between text-sm text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-3">
            <Check className="w-5 h-5 shrink-0 text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Documents
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Manage your personal documents and shared team workspaces
          </p>
        </div>

        <button
          onClick={() => {
            setNewTitle('Untitled Document')
            setIsCreateOpen(true)
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-all shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Document</span>
        </button>
      </div>

      {/* Tabs and Search Bar */}
      <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="flex items-center p-1 bg-zinc-100 dark:bg-zinc-800/70 rounded-xl w-fit">
          <button
            onClick={() => {
              setActiveTab('owned')
              setSearchQuery('')
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'owned'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Owned by me</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                activeTab === 'owned'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {ownedDocs.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab('shared')
              setSearchQuery('')
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer ${
              activeTab === 'shared'
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Shared with me</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                activeTab === 'shared'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {sharedDocs.length}
            </span>
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Document Grid / Empty States */}
      <div className="mt-8">
        {filteredDocs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 p-12 text-center bg-zinc-50/50 dark:bg-zinc-900/30 flex flex-col items-center justify-center">
            <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 mb-4">
              {searchQuery ? (
                <FileQuestion className="w-7 h-7" />
              ) : activeTab === 'owned' ? (
                <FileText className="w-7 h-7" />
              ) : (
                <Users className="w-7 h-7" />
              )}
            </div>

            {searchQuery ? (
              <>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  No documents found
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
                  We couldn&apos;t find anything matching &quot;{searchQuery}&quot;. Try a different search term.
                </p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400"
                >
                  Clear search query
                </button>
              </>
            ) : activeTab === 'owned' ? (
              <>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  No documents created yet
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
                  Get started by creating your first document to draft notes, articles, or project plans.
                </p>
                <button
                  onClick={() => {
                    setNewTitle('Untitled Document')
                    setIsCreateOpen(true)
                  }}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Document</span>
                </button>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  No documents shared with you
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm">
                  When other team members grant you Viewer or Editor access to their documents, they will appear here.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocs.map((doc) => {
              const isOwner = doc.role === 'owner'
              const canEdit = doc.role === 'owner' || doc.role === 'editor'

              return (
                <div
                  key={doc.id}
                  className="group relative flex flex-col justify-between rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-sm hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all"
                >
                  <div>
                    {/* Header: Icon & Role pill */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <FileText className="w-5 h-5" />
                      </div>
                      <span
                        className={`text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          isOwner
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : doc.role === 'editor'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        }`}
                      >
                        {doc.role}
                      </span>
                    </div>

                    {/* Title */}
                    <Link
                      href={`/docs/${doc.id}`}
                      className="block text-base font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-1 transition-colors"
                      title={doc.title}
                    >
                      {doc.title}
                    </Link>

                    {/* Subtitle / Owner if shared */}
                    {!isOwner && doc.owner_email && (
                      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate">
                        Owner: {doc.owner_email}
                      </p>
                    )}
                  </div>

                  {/* Footer: Date & Actions */}
                  <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{formatDate(doc.updated_at || doc.created_at)}</span>
                    </div>

                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <button
                          onClick={() => {
                            setRenameTarget(doc)
                            setRenameTitle(doc.title)
                          }}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                          title="Rename document"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {isOwner && (
                        <button
                          onClick={() => setDeleteTarget(doc)}
                          className="p-1.5 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer transition-colors"
                          title="Delete document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <Link
                        href={`/docs/${doc.id}`}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer transition-colors"
                        title="Open document"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* CREATE DOCUMENT MODAL */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Create new document
              </h3>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDocument}>
              <div className="mb-5">
                <label
                  htmlFor="newDocTitle"
                  className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1.5"
                >
                  Document title
                </label>
                <input
                  id="newDocTitle"
                  type="text"
                  required
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Q4 Strategy Memo"
                  disabled={createLoading}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={createLoading}
                  className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {createLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Create</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENAME DOCUMENT MODAL */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                Rename document
              </h3>
              <button
                onClick={() => setRenameTarget(null)}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRenameDocument}>
              <div className="mb-5">
                <label
                  htmlFor="renameDocTitle"
                  className="block text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1.5"
                >
                  Document title
                </label>
                <input
                  id="renameDocTitle"
                  type="text"
                  required
                  autoFocus
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  placeholder="Enter new title"
                  disabled={renameLoading}
                  className="w-full px-3.5 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRenameTarget(null)}
                  disabled={renameLoading}
                  className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renameLoading}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {renameLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6">
            <div className="w-11 h-11 rounded-xl bg-red-100 dark:bg-red-950/50 text-red-600 flex items-center justify-center mb-4">
              <Trash2 className="w-5 h-5" />
            </div>

            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              Delete &quot;{deleteTarget.title}&quot;?
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
              Are you sure you want to permanently delete this document? This action cannot be undone and will also revoke access from any collaborators.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteDocument}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Delete Document</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
