import type { ContactInquiry } from '../types'

export function generateContactInquiryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : (random & 0x3) | 0x8
    return value.toString(16)
  })
}

export function normalizeContactInquiry(raw: Partial<ContactInquiry> & { created_at?: string | null }): ContactInquiry {
  const status = raw.status === 'Read' || raw.status === 'Replied' ? raw.status : 'Unread'

  return {
    id: String(raw.id ?? generateContactInquiryId()),
    name: String(raw.name ?? ''),
    email: String(raw.email ?? ''),
    message: String(raw.message ?? ''),
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    status,
  }
}

export async function fetchContactInquiries(supabaseClient: any): Promise<ContactInquiry[]> {
  const { data, error } = await supabaseClient
    .from('contact_inquiries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((row: Record<string, any>) => normalizeContactInquiry({
    id: String((row as { id?: string }).id ?? generateContactInquiryId()),
    name: String((row as { name?: string }).name ?? ''),
    email: String((row as { email?: string }).email ?? ''),
    message: String((row as { message?: string }).message ?? ''),
    createdAt: String((row as { created_at?: string }).created_at ?? new Date().toISOString()),
    status: (row as { status?: ContactInquiry['status'] }).status ?? 'Unread',
  }))
}
