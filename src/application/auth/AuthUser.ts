export interface AuthUser {
  id: string
  organizationId: string
  fullName: string
  email: string
  role: 'admin' | 'coworker'
  status: 'active' | 'pending' | 'deactivated'
}
