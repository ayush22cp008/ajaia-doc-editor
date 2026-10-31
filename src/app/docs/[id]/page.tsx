import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DocumentEditor } from '@/components/editor/DocumentEditor'

export const instant = false

interface DocPageProps {
  params: Promise<{ id: string }>
}

export default async function DocumentPage({ params }: DocPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // 1. Fetch the document (RLS guarantees access check)
  const { data: doc, error } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error || !doc) {
    notFound()
  }

  // 2. Determine role
  let role: 'owner' | 'editor' | 'viewer' = 'viewer'
  if (doc.owner_id === user.id) {
    role = 'owner'
  } else {
    const { data: collab } = await supabase
      .from('document_collaborators')
      .select('role')
      .eq('document_id', doc.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (collab) {
      role = collab.role
    } else {
      // Not owner and not collaborator
      notFound()
    }
  }

  // 3. Fetch owner profile if user is not owner
  let ownerEmail: string | undefined = undefined
  if (role !== 'owner') {
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', doc.owner_id)
      .maybeSingle()

    ownerEmail = ownerProfile?.email
  }

  return (
    <DocumentEditor
      documentId={doc.id}
      initialTitle={doc.title}
      initialContent={doc.content}
      role={role}
      ownerEmail={ownerEmail}
      lastUpdatedAt={doc.updated_at}
    />
  )
}
