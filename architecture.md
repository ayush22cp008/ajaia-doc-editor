# Ajaia Docs — Architecture & Authorization Model

## Overview
Ajaia Docs is a lightweight, cloud-synchronized document editor inspired by Google Docs. The architecture is engineered around the principle of **defense-in-depth**, using Next.js 16 (App Router), TypeScript, Tailwind CSS, Tiptap, and Supabase PostgreSQL with strict Row Level Security (RLS).

---

## 1. Data Model

The data layer is deliberately kept minimal with exactly three application tables:

```
+--------------------+       1:N       +----------------------+
|   auth.users       | <-------------- |   public.profiles    |
+--------------------+                 +----------------------+
                                                  | 1:N
                                                  v
+-----------------------------+  N:1   +----------------------+
| public.document_            | -----> |   public.documents   |
| collaborators               |        +----------------------+
+-----------------------------+
```

1. **`public.profiles`**: Mirrors `auth.users` via a `SECURITY DEFINER` signup trigger.
   - `id` (`uuid`, PK, FK to `auth.users`)
   - `email` (`text`, unique)
   - `full_name` (`text`)
   - `created_at` (`timestamptz`)
2. **`public.documents`**: Stores document content and ownership.
   - `id` (`uuid`, PK, default `gen_random_uuid()`)
   - `title` (`text`, default `'Untitled Document'`)
   - `content` (`jsonb`, stores Tiptap ProseMirror JSON schema `{ type: 'doc', content: [...] }`)
   - `owner_id` (`uuid`, FK to `profiles.id`)
   - `created_at` (`timestamptz`)
   - `updated_at` (`timestamptz`, automated via trigger)
3. **`public.document_collaborators`**: Manages explicit document sharing permissions.
   - `id` (`uuid`, PK)
   - `document_id` (`uuid`, FK to `documents.id`)
   - `user_id` (`uuid`, FK to `profiles.id`)
   - `role` (`document_role` enum: `'viewer' | 'editor'`)
   - `created_at` (`timestamptz`)
   - Unique constraint on `(document_id, user_id)`

---

## 2. Authorization & Database Security Design

### Avoiding RLS Policy Recursion
Direct mutual references between `documents` and `document_collaborators` policies can cause infinite recursion cycles in PostgreSQL RLS evaluation. To resolve this:
- We encapsulate relation checks into **private schema helper functions**:
  - `private.can_access_document(doc_id, user_id)`
  - `private.can_edit_document(doc_id, user_id)`
  - `private.is_document_owner(doc_id, user_id)`
- These functions run with `SECURITY DEFINER`, an empty search path (`set search_path = ''`), fully qualified table identifiers, and are isolated inside the `private` schema with execution strictly controlled.

### Field Immutability Under RLS
An Editor collaborator must be allowed to modify document `title` and `content`, but must **never** be permitted to reassign ownership (`owner_id`), change document identity (`id`), or alter creation timestamps (`created_at`).
- We enforce this using the `WITH CHECK` clause on `public.documents`:
  ```sql
  with check (
    owner_id = (select d.owner_id from public.documents d where d.id = public.documents.id) and
    id = (select d.id from public.documents d where d.id = public.documents.id) and
    created_at = (select d.created_at from public.documents d where d.id = public.documents.id)
  );
  ```

### Anti-Enumeration for Profiles
To prevent malicious or rogue users from scraping user directories:
- `public.profiles` select policy allows reading:
  1. The authenticated user's own profile (`id = auth.uid()`).
  2. Profiles of users with whom the caller actively co-collaborates or shares documents.
- Direct UPDATE policies on `profiles` prevent modifying the user's `email` (only display name updates are permissible).

### Controlled Document Sharing RPC (`share_document`)
To eliminate race conditions and enforce owner validation:
- Direct client `INSERT`, `UPDATE`, and `DELETE` on `document_collaborators` are disabled.
- Collaborators can only be added or role-modified via the `public.share_document` RPC:
  - Verifies caller identity via `auth.uid()`.
  - Verifies caller is the legitimate document owner.
  - Normalizes recipient email and resolves their `user_id`.
  - Rejects self-sharing attempts (`caller_id = recipient_id`).
  - Validates role input (`viewer` or `editor`).
  - Atomically upserts collaborator mapping.

---

## 3. Client & Autosave Mechanics

### Reliable Autosave Handling
When autosaving document content:
- In Supabase, if an `UPDATE` query fails an RLS `USING` filter, PostgreSQL returns **0 affected rows** without raising a SQL runtime error.
- The autosave client specifically invokes `.select('id, updated_at')` on the update query:
  ```ts
  const { data, error } = await supabase
    .from('documents')
    .update({ title, content })
    .eq('id', docId)
    .select('id, updated_at')
  ```
- If `data` is empty and no network error occurred, the client flags an unauthorized write attempt and switches the UI to read-only mode.

---

## 4. Architectural Trade-offs & Assumptions

| Dimension | Chosen Approach | Trade-off / Rationale |
| :--- | :--- | :--- |
| **Document State** | ProseMirror JSONB (`content`) | Enables rich semantic editing while avoiding raw HTML string parsing and XSS injection. |
| **Realtime Sync** | Debounced Cloud Persistence (1000ms) | Full CRDT/Yjs operational transformation is out of scope for the 240-minute MVP. Debounced cloud persistence guarantees zero-data-loss durability across page refreshes. |
| **File Import** | Client-side Text & Markdown Parser | Fast, resilient, zero heavy external binaries; easily loads into Tiptap editor nodes. |
| **Security Layer** | Database-level RLS + RPCs | Client code cannot bypass security rules even if the frontend bundle is tampered with. |
