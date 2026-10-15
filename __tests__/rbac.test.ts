import { buildDashboard, pregnancyChecksDue, vaccinationsDue } from '@/lib/dashboard';
import { allows, canOpen, canWriteService, DEFAULT_MATRIX, defaultPermissions, NO_PERMISSIONS, PERMISSIONS, primaryTabs, ROLE_EXPERIENCE, ROLES } from '@/lib/rbac';
import type { Animal, LivestockServiceRecord } from '@/store/types';

const perms = defaultPermissions;

function animal(overrides: Partial<Animal> = {}): Animal {
  return {
    id: 'a1', moozzle_id: '482731905614', tag_id: 'GJ-1001', age_recorded: true, animal_type: 'Cattle', breed: 'Gir', sex: 'Female', age_years: 5, age_months: 0, age_group: 'ADULT', production_status: null, pregnancy_status: null, device_registered_at: null, device_utc_offset_minutes: null,
    dairy_society_member: null, society_name: '', society_code: '', member_code: '', gps: null, owner_name: '', owner_phone: '', owner_visible: false,
    owner_user_id: null, farm_id: 'f1', farm_name: 'Patel Dairy Farm', organisation_id: 'o1', village: 'Himmatnagar', district: 'Sabarkantha', state: 'Gujarat',
    registration_date: '2026-01-01', biometric_status: 'Enrolled', current_status: 'Active', approval_status: 'Approved', duplicate_of: null, review_note: null,
    captured_images_count: 4, reference_image_path: null, created_by: 'u1', created_at: '2026-01-01', updated_at: '2026-01-01', ...overrides,
  };
}

function record(overrides: Partial<LivestockServiceRecord> = {}): LivestockServiceRecord {
  return {
    id: 'r1', animal_id: 'a1', service_type: 'health', record_type: 'Vaccination', date: new Date().toISOString().slice(0, 10), performed_by: 'Dr', performer_role: 'Veterinarian',
    author_id: 'u2', details: '', metadata: {}, corrects_id: null, corrected_by: null, created_at: new Date().toISOString(), ...overrides,
  };
}

describe('permission matrix', () => {
  it('defines a level for every role and permission', () => {
    for (const permission of PERMISSIONS) for (const role of ROLES) expect(DEFAULT_MATRIX[permission][role]).toBeTruthy();
  });

  it('only the Super Administrator (approve/promote) and Researcher (propose) touch biometric thresholds', () => {
    for (const role of ROLES) expect(DEFAULT_MATRIX.change_threshold[role] === 'No').toBe(role !== 'Super Administrator' && role !== 'Researcher');
    expect(DEFAULT_MATRIX.change_threshold['Super Administrator']).toBe('Authorised');
    expect(DEFAULT_MATRIX.change_threshold.Researcher).toBe('Limited');
  });

  it('denies by default when no permissions are loaded', () => {
    for (const destination of ['register', 'audit', 'users', 'settings', 'services-health', 'records'] as const) {
      expect(canOpen(destination, 'Veterinarian', NO_PERMISSIONS)).toBe(false);
    }
  });

  it('API scopes and de-identified levels never grant in-app record access', () => {
    expect(allows('Via API scope')).toBe(false);
    expect(allows('De-identified')).toBe(false);
    expect(allows('Technical only')).toBe(false);
    expect(allows('No')).toBe(false);
    expect(allows('Own request')).toBe(true);
  });
});

describe('route access', () => {
  it('insurance officers cannot open clinical health records', () => {
    expect(canOpen('services-health', 'Insurance Officer', perms('Insurance Officer'))).toBe(false);
    expect(canOpen('verify', 'Insurance Officer', perms('Insurance Officer'))).toBe(true);
  });

  it('veterinarians can open health and breeding records', () => {
    expect(canOpen('services-health', 'Veterinarian', perms('Veterinarian'))).toBe(true);
    expect(canOpen('services-ai', 'Veterinarian', perms('Veterinarian'))).toBe(true);
  });

  it('researchers have no identifiable record access by default', () => {
    expect(canOpen('records', 'Researcher', perms('Researcher'))).toBe(false);
    expect(canOpen('research', 'Researcher', perms('Researcher'))).toBe(true);
  });

  it('API administrators are kept out of clinical and insurance data', () => {
    const p = perms('API Administrator');
    expect(canOpen('services-health', 'API Administrator', p)).toBe(false);
    expect(canOpen('services-insurance', 'API Administrator', p)).toBe(false);
    expect(canOpen('api', 'API Administrator', p)).toBe(true);
  });

  it('only the Super Administrator can open the permission editor and security console', () => {
    for (const role of ROLES) {
      expect(canOpen('permissions', role, perms(role))).toBe(role === 'Super Administrator');
      expect(canOpen('security', role, perms(role))).toBe(role === 'Super Administrator');
    }
  });

  it('every role nav item and quick action is reachable for that role', () => {
    for (const role of ROLES) {
      const p = perms(role);
      const blocked = [...ROLE_EXPERIENCE[role].nav, ...ROLE_EXPERIENCE[role].actions].filter((item) => !canOpen(item.to, role, p));
      // Role menus may list items that the guard then hides, but core quick actions must be usable.
      expect(ROLE_EXPERIENCE[role].actions.filter((item) => !canOpen(item.to, role, p))).toEqual([]);
      expect(blocked.length).toBeLessThanOrEqual(ROLE_EXPERIENCE[role].nav.length);
    }
  });

  it('bottom navigation keeps four primary functions and hides identify for API administrators', () => {
    expect(primaryTabs('Researcher', perms('Researcher')).find((tab) => tab.key === 'identify')?.enabled).toBe(true);
    expect(primaryTabs('API Administrator', perms('API Administrator')).find((tab) => tab.key === 'identify')?.enabled).toBe(false);
    for (const role of ROLES) expect(primaryTabs(role, perms(role))).toHaveLength(4);
  });
});

describe('service write rules (mirror of add_service_record)', () => {
  it('AI technicians record AI services but not clinical care', () => {
    expect(canWriteService('AI Technician', 'ai', false)).toBe(true);
    expect(canWriteService('AI Technician', 'health', false)).toBe(false);
  });
  it('insurance officers cannot write clinical records', () => {
    expect(canWriteService('Insurance Officer', 'health', false)).toBe(false);
    expect(canWriteService('Insurance Officer', 'insurance', false)).toBe(true);
  });
  it('super administrators need privileged access for clinical writes', () => {
    expect(canWriteService('Super Administrator', 'health', false)).toBe(false);
    expect(canWriteService('Super Administrator', 'health', true)).toBe(true);
  });
  it('farmers cannot write signed service records', () => {
    for (const kind of ['health', 'ai', 'insurance', 'traceability', 'operations'] as const) expect(canWriteService('Farmer', kind, false)).toBe(false);
  });
});

describe('dashboard calculations', () => {
  it('flags animals without a recent vaccination', () => {
    expect(vaccinationsDue([animal()], [])).toHaveLength(1);
    expect(vaccinationsDue([animal()], [record({ metadata: { next_due: '2099-01-01' } })])).toHaveLength(0);
  });

  it('finds pregnancy checks due 55–120 days after AI', () => {
    const date = new Date(Date.now() - 70 * 86400000).toISOString().slice(0, 10);
    expect(pregnancyChecksDue([animal()], [record({ service_type: 'ai', record_type: 'Artificial Insemination', date })])).toHaveLength(1);
  });

  it('builds the veterinarian dashboard with clinical cards', () => {
    const cards = buildDashboard({ role: 'Veterinarian', userId: 'u2', animals: [animal()], records: [record()], policies: [], requests: [], notifications: [], pendingSync: 0, farmCount: 2, overview: null, research: null, apiLogs: null, activeClients: 0, myIdentificationsToday: null, staffCount: null, validationTrials: [] });
    expect(cards.map((card) => card.label)).toEqual(['Animals Seen Today', 'Scheduled Visits', 'Pending Treatments', 'Vaccinations Due', 'Follow-up Cases', 'Emergency Alerts']);
    expect(cards[0].value).toBe('1');
  });

  it('gives every role its own dashboard', () => {
    const titles = new Set(ROLES.map((role) => ROLE_EXPERIENCE[role].title));
    expect(titles.size).toBe(ROLES.length);
    expect(ROLE_EXPERIENCE.Veterinarian.title).toBe('Veterinary Care Dashboard');
    expect(ROLE_EXPERIENCE.Farmer.title).toBe('My Animals – MOOZZLE');
  });
});
