import type { StaffAccount } from '../types'

const staffRoles: StaffAccount['role'][] = ['Doctor', 'Nurse', 'Reception', 'Counter Staff', 'Admin']

export async function fetchStaffAccounts(supabaseClient: any): Promise<StaffAccount[]> {
  const { data, error } = await supabaseClient
    .from('staff_profiles')
    .select('id, name, email, role')
    .order('name', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    email: String(row.email ?? ''),
    role: staffRoles.includes(row.role as StaffAccount['role']) ? row.role as StaffAccount['role'] : 'Reception',
  }))
}

export function mergeStaffAccounts(remote: StaffAccount[], local: StaffAccount[]): StaffAccount[] {
  const localByEmail = new Map(local.map((account) => [account.email.toLowerCase(), account]))
  const remoteEmails = new Set(remote.map((account) => account.email.toLowerCase()))
  const mergedRemote = remote.map((account) => {
    const localAccount = localByEmail.get(account.email.toLowerCase())
    return { ...account, password: localAccount?.password }
  })

  return [...mergedRemote, ...local.filter((account) => !remoteEmails.has(account.email.toLowerCase()))]
}

export async function saveStaffAccount(supabaseClient: any, account: StaffAccount): Promise<void> {
  const { error } = await supabaseClient.from('staff_profiles').upsert({
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  })

  if (error) throw error
}

export async function deleteStaffAccount(supabaseClient: any, id: string): Promise<void> {
  const { error } = await supabaseClient.from('staff_profiles').delete().eq('id', id)

  if (error) throw error
}

export function getStaffAccountErrorMessage(error: unknown): string {
  const supabaseError = error as { code?: string; message?: string }

  if (supabaseError?.code === 'PGRST205') {
    return 'The staff_profiles table is missing from Supabase. Run the staff_profiles SQL from supabase/schema.sql.'
  }
  if (supabaseError?.code === '42501') {
    return 'Supabase denied access to staff_profiles. Check its row-level security policies.'
  }
  if (supabaseError?.code === '23505') {
    return 'A staff account with this email already exists in Supabase.'
  }

  return supabaseError?.message ?? 'Check your Supabase connection and staff_profiles table.'
}