# Ajaia Docs

Ajaia Docs is a modern, lightweight collaborative document editor inspired by Google Docs, built with Next.js, Supabase, and Tiptap.

---

## Tech Stack
- **Framework**: [Next.js](https://nextjs.org/) (App Router, TypeScript)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Rich Text Editor**: [Tiptap](https://tiptap.dev/) (StarterKit, Headings, Lists, Underline)
- **Backend & Auth**: [Supabase](https://supabase.com/) (PostgreSQL with Row Level Security, Auth)
- **Deployment**: [Vercel](https://vercel.com/)

---

## Features
- 📝 **Rich-Text Editing**: Bold, italic, underline, headings (H1, H2, H3), bullet lists, and numbered lists.
- 💾 **Reliable Autosave & Persistence**: Changes persist across page refreshes with debounced cloud saving and visual status pills (`Saved`, `Saving...`).
- 📂 **Document Organization**: Clean distinction between **Owned by me** and **Shared with me** documents.
- 👥 **Access Control & Permissions**:
  - **Owner**: Full control, document renaming, deletion, and sharing management.
  - **Editor**: Can edit document title and content; cannot reassign ownership or delete.
  - **Viewer**: Read-only access with disabled toolbar and editing controls.
- 📥 **Document Import**: Import `.txt` and `.md` files directly into editable documents.
- 🔒 **Defense-in-Depth Security**: PostgreSQL RLS policies, non-recursive private security definer authorization routines, and atomic sharing RPCs.

---

## Local Setup Instructions

### 1. Prerequisites
- Node.js 18+ and npm
- A Supabase project (free tier)

### 2. Clone and Install Dependencies
```bash
git clone https://github.com/ayush22cp008/ajaja-doc-editor.git
cd ajaja-doc-editor
npm install
```

### 3. Environment Variables
Create a `.env.local` file in the root directory (refer to `.env.example`):
```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```
> [!IMPORTANT]
> Never commit `.env.local` or disclose secret service-role keys. The application operates strictly under Row Level Security with public client keys.

### 4. Database Setup
Execute the migration script in your hosted Supabase SQL Editor:
- [`supabase/migrations/20261031000000_init_ajaja_docs.sql`](file:///c:/Users/ayush/Desktop/ajaja-doc-editor/supabase/migrations/20261031000000_init_ajaja_docs.sql)

### 5. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Build and Typecheck
```bash
npm run build
npm run lint
```

---

## Milestone 2 Implementation: Auth & Dashboard

### 1. Authentication
- **Signup (`/signup`)**: Email, password, and full name registration. Automatically triggers `public.handle_auth_user_sync` to maintain synchronized `public.profiles`.
- **Login (`/login`)**: Email and password authentication with validation error feedback and loading spinners.
- **Session Persistence**: Built on `@supabase/ssr` with HTTP-only cookies and automatic token refresh via middleware (`src/middleware.ts` / `src/lib/supabase/middleware.ts`).
- **Auth Callback (`/auth/callback`)**: Exchanges email verification and OAuth callback codes for active user sessions.
- **Logout**: Client-side and server-side sign out clearing auth cookies and redirecting to `/login`.

### 2. Dashboard (`/dashboard`)
- **Owned Documents**: Lists all documents owned by the authenticated user with real-time counters and sorting by `updated_at`.
- **Shared Documents**: Lists documents shared with the user through `public.document_collaborators` along with collaborator roles (`editor` or `viewer`).
- **Create Document**: Instant modal dialog to create new documents with custom or default titles, inserting into `public.documents` under RLS.
- **Rename Document**: Accessible to owners and editors to update document titles.
- **Delete Document**: Owner-restricted action with confirmation modal to prevent accidental data loss.
- **Search & Filtering**: Real-time client search across document titles with dedicated empty states for zero results, no owned documents, and no shared documents.

### 3. Security & Authorization
- **Strict RLS**: All queries and mutations operate through the public anon key with `auth.uid()` checks.
- **Route Protection**: Middleware ensures unauthenticated requests to `/dashboard` and `/docs/*` are redirected to `/login`, and authenticated users visiting `/login` or `/signup` are routed directly to `/dashboard`.

---

## Documentation
- [Architecture & Security Model](file:///c:/Users/ayush/Desktop/ajaja-doc-editor/architecture.md)
