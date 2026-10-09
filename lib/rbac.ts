import type { Ionicons } from '@expo/vector-icons';

export const ROLES = [
  'Super Administrator',
  'Organisation Administrator',
  'Government Officer',
  'Veterinarian',
  'AI Technician',
  'Farmer',
  'Farm Manager',
  'Insurance Officer',
  'Livestock Inspector',
  'Field Worker',
  'Researcher',
  'API Administrator',
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'platform_settings',
  'manage_users',
  'identify_animal',
  'register_animal',
  'view_animal_profile',
  'health_records',
  'artificial_insemination',
  'insurance_records',
  'ownership_transfer',
  'view_reports',
  'export_records',
  'change_threshold',
  'retire_animal',
  'view_audit_logs',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const LEVELS = ['Full', 'Authorised', 'Scoped', 'Own', 'Own request', 'Limited', 'Request only', 'De-identified', 'Via API scope', 'Technical only', 'No'] as const;
export type Level = (typeof LEVELS)[number];
export type PermissionMap = Record<Permission, Level>;

export const PERMISSION_LABELS: Record<Permission, string> = {
  platform_settings: 'Platform settings',
  manage_users: 'Manage users',
  identify_animal: 'Identify animal',
  register_animal: 'Register animal',
  view_animal_profile: 'View animal profile',
  health_records: 'Health records',
  artificial_insemination: 'Artificial insemination',
  insurance_records: 'Insurance records',
  ownership_transfer: 'Ownership transfer',
  view_reports: 'View reports',
  export_records: 'Export records',
  change_threshold: 'Change biometric threshold',
  retire_animal: 'Retire animal',
  view_audit_logs: 'View audit logs',
};

/**
 * Initial matrix, identical to the database seed. The app always uses the matrix loaded from
 * the backend (role_permissions); this copy is only for tests and deny-by-default fallbacks.
 */
const M = (levels: Level[]): Record<Role, Level> => Object.fromEntries(ROLES.map((role, index) => [role, levels[index]])) as Record<Role, Level>;
export const DEFAULT_MATRIX: Record<Permission, Record<Role, Level>> = {
  platform_settings: M(['Full', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'Limited']),
  manage_users: M(['Full', 'Scoped', 'Limited', 'No', 'No', 'No', 'Limited', 'No', 'No', 'No', 'No', 'No']),
  identify_animal: M(['Full', 'Scoped', 'Scoped', 'Scoped', 'Scoped', 'Own', 'Scoped', 'Scoped', 'Scoped', 'Scoped', 'Limited', 'Via API scope']),
  register_animal: M(['Full', 'Scoped', 'Scoped', 'Limited', 'Limited', 'Own request', 'Scoped', 'No', 'Limited', 'Limited', 'No', 'Via API scope']),
  view_animal_profile: M(['Authorised', 'Scoped', 'Scoped', 'Scoped', 'Limited', 'Own', 'Scoped', 'Limited', 'Scoped', 'Limited', 'De-identified', 'Via API scope']),
  health_records: M(['Authorised', 'Limited', 'Scoped', 'Scoped', 'Limited', 'Own', 'Limited', 'No', 'Limited', 'No', 'De-identified', 'Via API scope']),
  artificial_insemination: M(['Authorised', 'Scoped', 'Scoped', 'Scoped', 'Scoped', 'Own', 'Scoped', 'No', 'Limited', 'Limited', 'De-identified', 'Via API scope']),
  insurance_records: M(['Authorised', 'Limited', 'Limited', 'No', 'No', 'Own', 'Limited', 'Scoped', 'No', 'No', 'De-identified', 'Via API scope']),
  ownership_transfer: M(['Authorised', 'Scoped', 'Scoped', 'No', 'No', 'Own request', 'Limited', 'No', 'Scoped', 'No', 'No', 'Via API scope']),
  view_reports: M(['Full', 'Scoped', 'Scoped', 'Own', 'Own', 'Own', 'Scoped', 'Scoped', 'Scoped', 'Own', 'Scoped', 'Technical only']),
  export_records: M(['Authorised', 'Scoped', 'Limited', 'Limited', 'Limited', 'Own', 'Scoped', 'Scoped', 'Limited', 'Limited', 'De-identified', 'Via API scope']),
  change_threshold: M(['Authorised', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No', 'No']),
  retire_animal: M(['Authorised', 'Limited', 'Authorised', 'Request only', 'Request only', 'Request only', 'Request only', 'No', 'Request only', 'No', 'No', 'No']),
  view_audit_logs: M(['Full', 'Scoped', 'Scoped', 'Own', 'Own', 'Own', 'Own', 'Scoped', 'Scoped', 'Own', 'No', 'Technical only']),
};

export function defaultPermissions(role: Role): PermissionMap {
  return Object.fromEntries(PERMISSIONS.map((permission) => [permission, DEFAULT_MATRIX[permission][role]])) as PermissionMap;
}

export const NO_PERMISSIONS: PermissionMap = Object.fromEntries(PERMISSIONS.map((permission) => [permission, 'No'])) as PermissionMap;

/** Levels that grant in-app access to records (API scopes are for integrations, not this app). */
const IN_APP_ACCESS: Level[] = ['Full', 'Authorised', 'Scoped', 'Own', 'Own request', 'Limited', 'Request only'];

export function allows(level: Level | undefined): boolean {
  return !!level && IN_APP_ACCESS.includes(level);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

/** Who can write which service record type — mirrors add_service_record on the server. */
export type ServiceKind = 'health' | 'ai' | 'insurance' | 'traceability' | 'operations';
export function canWriteService(role: Role, kind: ServiceKind, privileged: boolean): boolean {
  switch (kind) {
    case 'health':
      return role === 'Veterinarian' || role === 'Farm Manager' || (role === 'Super Administrator' && privileged);
    case 'ai':
      return role === 'AI Technician' || role === 'Veterinarian' || (role === 'Super Administrator' && privileged);
    case 'insurance':
      return role === 'Insurance Officer';
    case 'traceability':
      return role === 'Livestock Inspector' || role === 'Government Officer';
    case 'operations':
      return role === 'Farm Manager';
    default:
      return false;
  }
}

/** Health titles visible with Limited health access (no clinical diagnoses or prescriptions). */
export const LIMITED_HEALTH_TITLES = ['Vaccination', 'Pregnancy Diagnosis', 'Calving', 'Deworming'];

export function canReviewApprovals(role: Role): boolean {
  return role === 'Super Administrator' || role === 'Organisation Administrator' || role === 'Government Officer' || role === 'Livestock Inspector' || role === 'Veterinarian' || role === 'AI Technician';
}

export function canRequestService(role: Role): boolean {
  return role === 'Farmer' || role === 'Farm Manager';
}

export function usesTechnicalLanguage(role: Role): boolean {
  return role !== 'Farmer' && role !== 'Field Worker';
}

// ---------- Role experience ----------

type IconName = keyof typeof Ionicons.glyphMap;

export type Destination =
  | 'home'
  | 'identify'
  | 'records'
  | 'workspace'
  | 'register'
  | 'approvals'
  | 'requests'
  | 'audit'
  | 'reports'
  | 'users'
  | 'permissions'
  | 'settings'
  | 'api'
  | 'api-docs'
  | 'sync'
  | 'performance'
  | 'research'
  | 'notifications'
  | 'services-health'
  | 'services-ai'
  | 'services-insurance'
  | 'services-traceability'
  | 'services-operations'
  | 'verify'
  | 'security'
  | 'profile';

export interface NavItem {
  label: string;
  icon: IconName;
  to: Destination;
}

export interface QuickAction {
  label: string;
  icon: IconName;
  to: Destination;
}

export interface RoleExperience {
  short: string;
  title: string;
  subtitle: string;
  icon: IconName;
  tone: string;
  nav: NavItem[];
  actions: QuickAction[];
}

export const DESTINATION_ROUTES: Record<Destination, string> = {
  home: '/(tabs)',
  identify: '/(tabs)/identify',
  records: '/(tabs)/records',
  workspace: '/(tabs)/workspace',
  register: '/register',
  approvals: '/approvals',
  requests: '/requests',
  audit: '/audit',
  reports: '/reports',
  users: '/users',
  permissions: '/permissions',
  settings: '/platform-settings',
  api: '/api-clients',
  'api-docs': '/api-docs',
  sync: '/sync',
  performance: '/performance',
  research: '/research',
  notifications: '/notifications',
  'services-health': '/services?type=health',
  'services-ai': '/services?type=ai',
  'services-insurance': '/services?type=insurance',
  'services-traceability': '/services?type=traceability',
  'services-operations': '/services?type=operations',
  verify: '/verify',
  security: '/security',
  profile: '/profile',
};

const n = (label: string, icon: IconName, to: Destination): NavItem => ({ label, icon, to });

export const ROLE_EXPERIENCE: Record<Role, RoleExperience> = {
  'Super Administrator': {
    short: 'Super Admin',
    title: 'MOOZZLE Platform Administration',
    subtitle: 'Platform operations, security and configuration',
    icon: 'shield-half-outline',
    tone: '#7C3AED',
    nav: [n('Animal Database', 'albums-outline', 'records'), n('Biometric Engine', 'finger-print-outline', 'settings'), n('User Management', 'people-outline', 'users'), n('Organisation Management', 'business-outline', 'users'), n('Roles and Permissions', 'key-outline', 'permissions'), n('Breed Management', 'git-branch-outline', 'reports'), n('Performance and Validation', 'speedometer-outline', 'performance'), n('API Management', 'code-slash-outline', 'api'), n('Security', 'lock-closed-outline', 'security'), n('Audit Logs', 'reader-outline', 'audit'), n('Data Retention', 'archive-outline', 'settings'), n('Reports', 'bar-chart-outline', 'reports'), n('System Settings', 'settings-outline', 'settings')],
    actions: [{ label: 'PRIVILEGED ACCESS', icon: 'lock-open-outline', to: 'security' }, { label: 'AUDIT LOGS', icon: 'reader-outline', to: 'audit' }, { label: 'USERS & ROLES', icon: 'people-outline', to: 'users' }, { label: 'SYSTEM SETTINGS', icon: 'settings-outline', to: 'settings' }],
  },
  'Organisation Administrator': {
    short: 'Org Admin',
    title: 'Organisation Administration',
    subtitle: 'Animals, staff and approvals in your organisation',
    icon: 'business-outline',
    tone: '#0369A1',
    nav: [n('Organisation Animals', 'albums-outline', 'records'), n('Farmers and Farms', 'home-outline', 'users'), n('Staff Management', 'people-outline', 'users'), n('Role Assignments', 'key-outline', 'users'), n('Service Records', 'medkit-outline', 'services-health'), n('Approvals', 'checkmark-done-outline', 'approvals'), n('Reports', 'bar-chart-outline', 'reports'), n('Organisation Settings', 'settings-outline', 'profile'), n('Audit History', 'reader-outline', 'audit')],
    actions: [{ label: 'REVIEW APPROVALS', icon: 'checkmark-done-outline', to: 'approvals' }, { label: 'REGISTER ANIMAL', icon: 'add-circle-outline', to: 'register' }, { label: 'STAFF & ROLES', icon: 'people-outline', to: 'users' }, { label: 'REPORTS', icon: 'bar-chart-outline', to: 'reports' }],
  },
  'Government Officer': {
    short: 'Govt Officer',
    title: 'Department Livestock Monitoring',
    subtitle: 'Jurisdiction coverage, schemes and traceability',
    icon: 'flag-outline',
    tone: '#B45309',
    nav: [n('Animal Registry', 'albums-outline', 'records'), n('District / Block / Village Coverage', 'map-outline', 'reports'), n('Veterinary Services', 'medkit-outline', 'services-health'), n('Breeding Services', 'heart-outline', 'services-ai'), n('Traceability', 'navigate-outline', 'services-traceability'), n('Scheme Monitoring', 'clipboard-outline', 'reports'), n('Approvals', 'checkmark-done-outline', 'approvals'), n('Data Quality', 'pulse-outline', 'reports'), n('Audit History', 'reader-outline', 'audit')],
    actions: [{ label: 'VERIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'COVERAGE REPORT', icon: 'map-outline', to: 'reports' }, { label: 'TRACEABILITY', icon: 'navigate-outline', to: 'services-traceability' }, { label: 'REVIEW QUEUE', icon: 'checkmark-done-outline', to: 'approvals' }],
  },
  Veterinarian: {
    short: 'Veterinarian',
    title: 'Veterinary Care Dashboard',
    subtitle: 'Clinical care for your assigned farms',
    icon: 'medkit-outline',
    tone: '#059669',
    nav: [n('Identify Animal', 'scan-outline', 'identify'), n('My Animal Cases', 'albums-outline', 'records'), n('Health Records', 'medkit-outline', 'services-health'), n('Treatment & Vaccination', 'bandage-outline', 'services-health'), n('Help Requests', 'alert-circle-outline', 'approvals'), n('Reproductive Health', 'heart-outline', 'services-ai'), n('Visit History', 'time-outline', 'audit'), n('Offline Records', 'cloud-upload-outline', 'sync')],
    actions: [{ label: 'IDENTIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'MY CASES', icon: 'albums-outline', to: 'records' }, { label: 'HEALTH RECORDS', icon: 'medkit-outline', to: 'services-health' }, { label: 'HELP REQUESTS', icon: 'alert-circle-outline', to: 'approvals' }],
  },
  'AI Technician': {
    short: 'AI Technician',
    title: 'AI Technician Field Dashboard',
    subtitle: 'Breeding services for your assigned farms',
    icon: 'flask-outline',
    tone: '#0E7490',
    nav: [n('Identify Animal', 'scan-outline', 'identify'), n('Register Animal', 'add-circle-outline', 'register'), n('Artificial Insemination', 'flask-outline', 'services-ai'), n('Breeding History', 'git-network-outline', 'services-ai'), n('Farmer Visits', 'walk-outline', 'approvals'), n('Offline Records', 'cloud-upload-outline', 'sync'), n('My Performance', 'trophy-outline', 'reports'), n('My Activity', 'reader-outline', 'audit')],
    actions: [{ label: 'SCAN ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'RECORD ARTIFICIAL INSEMINATION', icon: 'flask-outline', to: 'records' }, { label: 'VIEW BREEDING HISTORY', icon: 'git-network-outline', to: 'services-ai' }, { label: 'FOLLOW-UP VISITS', icon: 'walk-outline', to: 'approvals' }, { label: 'SYNC DATA', icon: 'sync-outline', to: 'sync' }],
  },
  Farmer: {
    short: 'Farmer',
    title: 'My Animals – MOOZZLE',
    subtitle: 'Your cattle and buffalo',
    icon: 'leaf-outline',
    tone: '#15803D',
    nav: [n('My Animals', 'albums-outline', 'records'), n('Health & Vaccination', 'medkit-outline', 'services-health'), n('Breeding', 'heart-outline', 'services-ai'), n('Insurance', 'umbrella-outline', 'services-insurance'), n('My Requests', 'chatbubbles-outline', 'requests'), n('Notifications', 'notifications-outline', 'notifications'), n('Help and Support', 'help-buoy-outline', 'requests')],
    actions: [{ label: 'MY ANIMALS', icon: 'albums-outline', to: 'records' }, { label: 'SCAN / VERIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'ADD ANIMAL', icon: 'add-circle-outline', to: 'register' }, { label: 'HEALTH AND VACCINATION', icon: 'medkit-outline', to: 'services-health' }, { label: 'BREEDING HISTORY', icon: 'heart-outline', to: 'services-ai' }, { label: 'INSURANCE DETAILS', icon: 'umbrella-outline', to: 'services-insurance' }, { label: 'GET VETERINARY HELP', icon: 'call-outline', to: 'requests' }],
  },
  'Farm Manager': {
    short: 'Farm Manager',
    title: 'Farm Operations Dashboard',
    subtitle: 'Daily work on your assigned farms',
    icon: 'home-outline',
    tone: '#4D7C0F',
    nav: [n('Animal Register', 'albums-outline', 'records'), n('Identify Animal', 'scan-outline', 'identify'), n('Daily Operations', 'today-outline', 'services-operations'), n('Health and Vaccination', 'medkit-outline', 'services-health'), n('Breeding', 'heart-outline', 'services-ai'), n('Schedule Visits', 'calendar-outline', 'requests'), n('Staff', 'people-outline', 'users'), n('Reports', 'bar-chart-outline', 'reports')],
    actions: [{ label: 'DAILY OPERATIONS', icon: 'today-outline', to: 'services-operations' }, { label: 'SCHEDULE VET / AI VISIT', icon: 'calendar-outline', to: 'requests' }, { label: 'IDENTIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'FARM REPORT', icon: 'bar-chart-outline', to: 'reports' }],
  },
  'Insurance Officer': {
    short: 'Insurance',
    title: 'Insurance Verification Desk',
    subtitle: 'Identity checks for assigned policies and claims',
    icon: 'umbrella-outline',
    tone: '#1D4ED8',
    nav: [n('Verify Animal', 'shield-checkmark-outline', 'verify'), n('Assigned Policies', 'document-text-outline', 'records'), n('Animal Insurance Records', 'umbrella-outline', 'services-insurance'), n('Claim Verification', 'checkmark-circle-outline', 'verify'), n('Verification History', 'time-outline', 'audit'), n('Reports', 'bar-chart-outline', 'reports')],
    actions: [{ label: 'VERIFY ANIMAL', icon: 'shield-checkmark-outline', to: 'verify' }, { label: 'ASSIGNED POLICIES', icon: 'document-text-outline', to: 'records' }, { label: 'VERIFICATION HISTORY', icon: 'time-outline', to: 'audit' }, { label: 'REPORTS', icon: 'bar-chart-outline', to: 'reports' }],
  },
  'Livestock Inspector': {
    short: 'Inspector',
    title: 'Traceability & Inspection',
    subtitle: 'Movement, ownership and identity in your jurisdiction',
    icon: 'navigate-outline',
    tone: '#9A3412',
    nav: [n('Identify Animal', 'scan-outline', 'identify'), n('Animal History', 'albums-outline', 'records'), n('Movement Records', 'navigate-outline', 'services-traceability'), n('Ownership Transfer', 'swap-horizontal-outline', 'approvals'), n('Inspection Records', 'clipboard-outline', 'services-traceability'), n('Traceability Reports', 'bar-chart-outline', 'reports'), n('Audit History', 'reader-outline', 'audit')],
    actions: [{ label: 'IDENTIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'OWNERSHIP TRANSFERS', icon: 'swap-horizontal-outline', to: 'approvals' }, { label: 'MOVEMENT RECORDS', icon: 'navigate-outline', to: 'services-traceability' }, { label: 'TRACEABILITY REPORT', icon: 'bar-chart-outline', to: 'reports' }],
  },
  'Field Worker': {
    short: 'Field Worker',
    title: 'Field Registration Dashboard',
    subtitle: 'Capture and register animals on assigned farms',
    icon: 'walk-outline',
    tone: '#047857',
    nav: [n('Register Animal', 'add-circle-outline', 'register'), n('Capture Muzzle', 'camera-outline', 'register'), n('Identify Animal', 'scan-outline', 'identify'), n('My Assigned Farms', 'home-outline', 'records'), n('Draft Records', 'document-outline', 'records'), n('Synchronisation', 'sync-outline', 'sync'), n('My Activity', 'reader-outline', 'audit')],
    actions: [{ label: 'REGISTER ANIMAL', icon: 'add-circle-outline', to: 'register' }, { label: 'IDENTIFY ANIMAL', icon: 'scan-outline', to: 'identify' }, { label: 'DRAFT RECORDS', icon: 'document-outline', to: 'records' }, { label: 'SYNC DATA', icon: 'sync-outline', to: 'sync' }],
  },
  Researcher: {
    short: 'Researcher',
    title: 'Research & Validation Workspace',
    subtitle: 'De-identified biometric datasets and model validation',
    icon: 'analytics-outline',
    tone: '#6D28D9',
    nav: [n('Approved Dataset', 'server-outline', 'research'), n('Model Validation', 'flask-outline', 'performance'), n('Performance Metrics', 'speedometer-outline', 'performance'), n('Breed Analysis', 'git-branch-outline', 'research'), n('Environmental Conditions', 'partly-sunny-outline', 'performance'), n('Reports', 'bar-chart-outline', 'reports')],
    actions: [{ label: 'APPROVED DATASET', icon: 'server-outline', to: 'research' }, { label: 'MODEL VALIDATION', icon: 'flask-outline', to: 'performance' }, { label: 'BREED ANALYSIS', icon: 'git-branch-outline', to: 'research' }, { label: 'EXPORT DE-IDENTIFIED', icon: 'download-outline', to: 'research' }],
  },
  'API Administrator': {
    short: 'API Admin',
    title: 'Integration Administration',
    subtitle: 'Scoped clients, credentials and integration health',
    icon: 'code-slash-outline',
    tone: '#334155',
    nav: [n('API Clients', 'apps-outline', 'api'), n('API Credentials', 'key-outline', 'api'), n('Endpoint Permissions', 'git-merge-outline', 'api'), n('Integration Logs', 'list-outline', 'api'), n('Rate Limits', 'speedometer-outline', 'api'), n('Webhooks', 'git-pull-request-outline', 'api'), n('API Documentation', 'book-outline', 'api-docs'), n('Technical Audit', 'reader-outline', 'audit')],
    actions: [{ label: 'API CLIENTS', icon: 'apps-outline', to: 'api' }, { label: 'INTEGRATION LOGS', icon: 'list-outline', to: 'api' }, { label: 'TECHNICAL AUDIT', icon: 'reader-outline', to: 'audit' }, { label: 'API DOCS', icon: 'book-outline', to: 'api-docs' }],
  },
};

/** Bottom tabs: four primary functions; everything else lives under Workspace ("More"). */
export function primaryTabs(role: Role, permissions: PermissionMap): { key: 'home' | 'identify' | 'records' | 'workspace'; enabled: boolean }[] {
  return [
    { key: 'home', enabled: true },
    { key: 'identify', enabled: allows(permissions.identify_animal) || role === 'Insurance Officer' },
    { key: 'records', enabled: allows(permissions.view_animal_profile) || role === 'Researcher' },
    { key: 'workspace', enabled: true },
  ];
}

/** Destinations a role may open directly; anything else shows Permission Denied. */
export function canOpen(destination: Destination, role: Role, permissions: PermissionMap): boolean {
  switch (destination) {
    case 'register':
      return allows(permissions.register_animal);
    case 'identify':
      return allows(permissions.identify_animal);
    case 'records':
      return allows(permissions.view_animal_profile);
    case 'approvals':
      return canReviewApprovals(role);
    case 'requests':
      return role !== 'Researcher' && role !== 'API Administrator';
    case 'audit':
      return allows(permissions.view_audit_logs) || permissions.view_audit_logs === 'Technical only';
    case 'reports':
      return permissions.view_reports !== 'No';
    case 'users':
      return allows(permissions.manage_users);
    case 'permissions':
      return role === 'Super Administrator';
    case 'settings':
      return permissions.platform_settings !== 'No';
    case 'security':
      return role === 'Super Administrator';
    case 'api':
      return role === 'API Administrator' || role === 'Super Administrator';
    case 'research':
      return role === 'Researcher' || role === 'Super Administrator';
    case 'services-health':
      return allows(permissions.health_records);
    case 'services-ai':
      return allows(permissions.artificial_insemination);
    case 'services-insurance':
      return allows(permissions.insurance_records);
    case 'services-traceability':
      return allows(permissions.view_animal_profile);
    case 'services-operations':
      return role === 'Farm Manager' || role === 'Farmer' || role === 'Organisation Administrator' || role === 'Super Administrator';
    case 'verify':
      return role === 'Insurance Officer' || allows(permissions.identify_animal);
    case 'sync':
      return allows(permissions.register_animal) || role === 'Veterinarian' || role === 'AI Technician';
    default:
      return true;
  }
}
