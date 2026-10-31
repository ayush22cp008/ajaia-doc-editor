import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Navbar } from '@/components/dashboard/Navbar'
import { DashboardClient, DocumentItem } from '@/components/dashboard/DashboardClient'

export const instant = false

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // 1. Fetch user's profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', user.id)
    .maybeSingle()

  // 2. Fetch owned documents
  const { data: ownedData } = await supabase
    .from('documents')
    .select('id, title, owner_id, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false })

  const initialOwnedDocs: DocumentItem[] = (ownedData || []).map((doc) => ({
    id: doc.id,
    title: doc.title,
    owner_id: doc.owner_id,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    role: 'owner',
  }))

  // 3. Fetch shared documents via document_collaborators
  const { data: collaborations } = await supabase
    .from('document_collaborators')
    .select('id, document_id, role, created_at')
    .eq('user_id', user.id)

  let initialSharedDocs: DocumentItem[] = []

  if (collaborations && collaborations.length > 0) {
    const docIds = collaborations.map((c) => c.document_id)
    const { data: docs } = await supabase
      .from('documents')
      .select('id, title, owner_id, created_at, updated_at')
      .in('id', docIds)

    if (docs && docs.length > 0) {
      const ownerIds = Array.from(new Set(docs.map((d) => d.owner_id)))
      const { data: ownerProfiles } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', ownerIds)

      const profileMap = new Map(ownerProfiles?.map((p) => [p.id, p.email]) || [])
      const roleMap = new Map(collaborations.map((c) => [c.document_id, c.role]))

      initialSharedDocs = docs.map((d) => ({
        id: d.id,
        title: d.title,
        owner_id: d.owner_id,
        created_at: d.created_at,
        updated_at: d.updated_at,
        role: (roleMap.get(d.id) as 'editor' | 'viewer') || 'viewer',
        owner_email: profileMap.get(d.owner_id),
      }))
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col">
      <Navbar
        userEmail={user.email || ''}
        userName={profile?.full_name || user.user_metadata?.full_name}
      />
      <main className="flex-1">
        <DashboardClient
          initialOwnedDocs={initialOwnedDocs}
          initialSharedDocs={initialSharedDocs}
          userId={user.id}
          userEmail={user.email || ''}
        />
      </main>
    </div>
  )
}
