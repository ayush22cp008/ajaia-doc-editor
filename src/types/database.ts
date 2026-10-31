export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type DocumentRole = 'viewer' | 'editor'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  created_at: string
}

export interface Document {
  id: string
  title: string
  content: Json
  owner_id: string
  created_at: string
  updated_at: string
}

export interface DocumentCollaborator {
  id: string
  document_id: string
  user_id: string
  role: DocumentRole
  created_at: string
  profile?: Profile
}

export interface DocumentWithRole extends Document {
  role: 'owner' | 'editor' | 'viewer'
  owner_email?: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          email: string
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          created_at?: string
        }
      }
      documents: {
        Row: Document
        Insert: {
          id?: string
          title?: string
          content?: Json
          owner_id: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          title?: string
          content?: Json
          owner_id?: string
          created_at?: string
          updated_at?: string
        }
      }
      document_collaborators: {
        Row: DocumentCollaborator
        Insert: {
          id?: string
          document_id: string
          user_id: string
          role?: DocumentRole
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          user_id?: string
          role?: DocumentRole
          created_at?: string
        }
      }
    }
    Functions: {
      share_document: {
        Args: {
          target_document_id: string
          recipient_email: string
          assigned_role: DocumentRole
        }
        Returns: {
          collaborator_id: string
          document_id: string
          user_id: string
          role: DocumentRole
          email: string
        }
      }
    }
  }
}
