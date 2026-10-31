'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { createClient } from '@/lib/supabase/client'
import { EditorToolbar } from './EditorToolbar'
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  Eye,
  Shield,
  RotateCw,
} from 'lucide-react'
import type { Json } from '@/types/database'

interface DocumentEditorProps {
  documentId: string
  initialTitle: string
  initialContent: Json
  role: 'owner' | 'editor' | 'viewer'
  ownerEmail?: string
  lastUpdatedAt: string
}

type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error'

export function DocumentEditor({
  documentId,
  initialTitle,
  initialContent,
  role,
  ownerEmail,
  lastUpdatedAt,
}: DocumentEditorProps) {
  const supabase = createClient()
  const canEdit = role === 'owner' || role === 'editor'

  const [title, setTitle] = useState(initialTitle)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(new Date(lastUpdatedAt))

  // Refs for debouncing and keeping latest states
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const titleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const latestContentRef = useRef<Json>(initialContent)
  const latestTitleRef = useRef<string>(initialTitle)

  // Atomic save routine
  const persistChanges = useCallback(
    async (contentToSave: Json, titleToSave: string) => {
      if (!canEdit) return

      try {
        setSaveStatus('saving')
        setErrorMessage(null)

        const { error } = await supabase
          .from('documents')
          .update({
            content: contentToSave,
            title: titleToSave,
          })
          .eq('id', documentId)

        if (error) {
          throw new Error(error.message)
        }

        setSaveStatus('saved')
        setLastSavedTime(new Date())
      } catch (err: unknown) {
        setSaveStatus('error')
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save changes.')
      }
    },
    [canEdit, documentId, supabase]
  )

  // Trigger debounced autosave for content
  const handleContentUpdate = useCallback(
    (newContent: Json) => {
      if (!canEdit) return
      latestContentRef.current = newContent
      setSaveStatus('unsaved')

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }

      debounceTimerRef.current = setTimeout(() => {
        persistChanges(latestContentRef.current, latestTitleRef.current)
      }, 1000)
    },
    [canEdit, persistChanges]
  )

  // Trigger debounced save for title
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return
    const newTitle = e.target.value
    setTitle(newTitle)
    latestTitleRef.current = newTitle
    setSaveStatus('unsaved')

    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current)
    }

    titleTimerRef.current = setTimeout(() => {
      persistChanges(latestContentRef.current, newTitle)
    }, 1000)
  }

  // Save immediately on blur if unsaved
  const handleTitleBlur = () => {
    if (!canEdit) return
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current)
    }
    persistChanges(latestContentRef.current, title)
  }

  // Tiptap Editor initialization
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Underline,
    ],
    content: (initialContent as Record<string, unknown>) || { type: 'doc', content: [] },
    editable: canEdit,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'tiptap prose dark:prose-invert max-w-none focus:outline-none min-h-[600px] p-6 sm:p-12 text-zinc-900 dark:text-zinc-100 font-sans',
      },
    },
    onUpdate: ({ editor }) => {
      handleContentUpdate(editor.getJSON() as Json)
    },
  })

  // Warn user if navigating away while saving
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === 'saving' || saveStatus === 'unsaved') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    }
  }, [saveStatus])

  function formatTime(date: Date | null) {
    if (!date) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-30 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          {/* Left: Back & Title */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Link
              href="/dashboard"
              className="p-2 rounded-lg text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
              title="Return to Dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <div className="flex items-center gap-2 flex-1 min-w-0">
              {canEdit ? (
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  onBlur={handleTitleBlur}
                  placeholder="Untitled Document"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 bg-transparent hover:bg-zinc-100/80 dark:hover:bg-zinc-800/80 focus:bg-white dark:focus:bg-zinc-800 px-2 py-1 rounded-md border border-transparent focus:border-zinc-300 dark:focus:border-zinc-700 focus:outline-none transition-all truncate max-w-sm sm:max-w-md"
                />
              ) : (
                <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 px-2 py-1 truncate">
                  {title}
                </h1>
              )}

              {/* Role Badge */}
              <span
                className={`hidden sm:inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider px-2.5 py-0.5 rounded-full shrink-0 ${
                  role === 'owner'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : role === 'editor'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}
              >
                {role === 'viewer' ? <Eye className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                <span>{role}</span>
              </span>
            </div>
          </div>

          {/* Right: Autosave Status Pill & Actions */}
          <div className="flex items-center gap-3 shrink-0">
            {canEdit ? (
              <div className="flex items-center gap-2">
                {saveStatus === 'saving' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 text-xs font-medium animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving...</span>
                  </div>
                )}

                {saveStatus === 'unsaved' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 text-xs font-medium">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    <span>Unsaved</span>
                  </div>
                )}

                {saveStatus === 'saved' && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
                    <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Saved {lastSavedTime ? `at ${formatTime(lastSavedTime)}` : ''}</span>
                  </div>
                )}

                {saveStatus === 'error' && (
                  <div className="flex items-center gap-2">
                    <div
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 text-xs font-medium"
                      title={errorMessage || undefined}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>{errorMessage ? 'Save failed' : 'Save failed'}</span>
                    </div>
                    <button
                      onClick={() => persistChanges(latestContentRef.current, latestTitleRef.current)}
                      className="p-1 rounded text-red-600 hover:bg-red-100 dark:hover:bg-red-950 text-xs font-medium cursor-pointer"
                      title="Retry Save"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs font-medium">
                <Eye className="w-3.5 h-3.5" />
                <span>View only</span>
              </div>
            )}
          </div>
        </div>

        {/* Rich-Text Formatting Toolbar */}
        <EditorToolbar editor={editor} disabled={!canEdit} />
      </header>

      {/* Viewer Banner if in read-only mode */}
      {!canEdit && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 py-2 px-4 text-center text-xs text-amber-800 dark:text-amber-300 flex items-center justify-center gap-2">
          <Eye className="w-4 h-4 shrink-0" />
          <span>
            You have <strong>Viewer permissions</strong> on this document. Edits and title updates are disabled.
            {ownerEmail && ` Owned by ${ownerEmail}.`}
          </span>
        </div>
      )}

      {/* Main Document Canvas (Google Docs style page container) */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 flex flex-col">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-md border border-zinc-200/80 dark:border-zinc-800/80 min-h-[750px] transition-all">
          <EditorContent editor={editor} />
        </div>
      </main>
    </div>
  )
}
