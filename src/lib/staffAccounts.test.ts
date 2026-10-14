import { describe, expect, it } from 'vitest'
import type { StaffAccount } from '../types'
import { mergeStaffAccounts } from './staffAccounts'

const localStaff: StaffAccount = {
  id: 's-1',
  name: 'Morgan Lee',
  email: 'morgan@mediqueue.sk',
  password: 'local-only-password',
  role: 'Doctor',
}

describe('mergeStaffAccounts', () => {
  it('keeps local passwords when matching cloud staff profiles', () => {
    const remoteStaff = [{ ...localStaff, password: undefined, name: 'Morgan Lee Updated' }]

    expect(mergeStaffAccounts(remoteStaff, [localStaff])).toEqual([
      { ...remoteStaff[0], password: localStaff.password },
    ])
  })

  it('keeps locally stored accounts that are not in the cloud yet', () => {
    expect(mergeStaffAccounts([], [localStaff])).toEqual([localStaff])
  })
})