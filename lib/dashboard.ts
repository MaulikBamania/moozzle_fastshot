import type { Ionicons } from '@expo/vector-icons';
import type { Destination, Role } from './rbac';
import type { Animal, LivestockServiceRecord, NotificationRow, PolicyRow, RequestRow } from '@/store/types';

type IconName = keyof typeof Ionicons.glyphMap;

export interface DashCard {
  label: string;
  value: string;
  icon: IconName;
  to: Destination;
  tone: 'green' | 'blue' | 'amber' | 'red' | 'slate' | 'violet';
  hint?: string;
}

export interface PlatformOverview {
  animals: number;
  cattle: number;
  buffalo: number;
  active: number;
  organisations: number;
  farmers: number;
  field_workers: number;
  identifications: number;
  failed_identifications: number;
  pending_approvals: number;
  security_events: number;
  failed_logins: number;
  api_requests: number;
  api_failures: number;
  breeds: Record<string, number>;
  districts: Record<string, number>;
  quality: Record<string, number>;
}

export interface ResearchRow {
  subject: string;
  species: string;
  breed: string;
  sex: string;
  age_years: number;
  state: string;
  quality_score: number;
  captures: number;
  model_version: string;
  enrolled_month: string;
}

export interface ApiLogRow {
  id: string;
  client_id: string | null;
  endpoint: string;
  method: string;
  status_code: number;
  latency_ms: number;
  error: string;
  created_at: string;
}

export interface DashboardInput {
  role: Role;
  userId: string;
  animals: Animal[];
  records: LivestockServiceRecord[];
  policies: PolicyRow[];
  requests: RequestRow[];
  notifications: NotificationRow[];
  pendingSync: number;
  farmCount: number;
  overview: PlatformOverview | null;
  research: ResearchRow[] | null;
  apiLogs: ApiLogRow[] | null;
  activeClients: number;
  myIdentificationsToday: number | null;
  staffCount: number | null;
  validationTrials: { far: number; frr: number }[];
}

const DAY = 86400000;
const fmt = (value: number) => (value >= 10000 ? `${(value / 1000).toFixed(1)}k` : String(value));
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const withinDays = (iso: string, days: number) => Date.now() - new Date(iso).getTime() <= days * DAY;

/** Vaccinations due: an explicit next_due within 30 days, or no vaccination recorded for 180 days. */
export function vaccinationsDue(animals: Animal[], records: LivestockServiceRecord[]): Animal[] {
  return animals.filter((animal) => {
    if (animal.current_status !== 'Active' || animal.approval_status === 'Draft') return false;
    const vaccinations = records.filter((record) => record.animal_id === animal.id && record.record_type === 'Vaccination' && !record.corrected_by);
    if (vaccinations.length === 0) return true;
    const latest = vaccinations[0];
    const nextDue = latest.metadata.next_due ? new Date(latest.metadata.next_due).getTime() : null;
    if (nextDue) return nextDue - Date.now() <= 30 * DAY;
    return !withinDays(latest.date, 180);
  });
}

/** Pregnancy check due: an AI service 55–120 days ago with no pregnancy diagnosis since. */
export function pregnancyChecksDue(animals: Animal[], records: LivestockServiceRecord[]): Animal[] {
  return animals.filter((animal) => {
    const ai = records.find((record) => record.animal_id === animal.id && record.service_type === 'ai');
    if (!ai) return false;
    const age = (Date.now() - new Date(ai.date).getTime()) / DAY;
    if (age < 55 || age > 120) return false;
    return !records.some((record) => record.animal_id === animal.id && record.record_type === 'Pregnancy Diagnosis' && record.date >= ai.date);
  });
}

export function followUpsDue(records: LivestockServiceRecord[]): LivestockServiceRecord[] {
  return records.filter((record) => record.metadata.follow_up && withinDays(record.date, 14) && !record.corrected_by);
}

export function buildDashboard(input: DashboardInput): DashCard[] {
  const { role, animals, records, policies, requests, notifications, overview } = input;
  const approved = animals.filter((animal) => animal.approval_status !== 'Draft');
  const cattle = approved.filter((animal) => animal.animal_type === 'Cattle').length;
  const buffalo = approved.filter((animal) => animal.animal_type === 'Buffalo').length;
  const mine = records.filter((record) => record.author_id === input.userId);
  const pendingReviews = animals.filter((animal) => animal.approval_status === 'Submitted' || animal.approval_status === 'Pending Review');
  const openRequests = requests.filter((request) => request.status === 'Submitted' && request.requested_by !== input.userId);
  const due = vaccinationsDue(animals, records);

  switch (role) {
    case 'Super Administrator': {
      const o = overview;
      const v = (n: number | undefined) => (o ? fmt(n ?? 0) : '—');
      const apiHealth = o && o.api_requests > 0 ? `${Math.round(((o.api_requests - o.api_failures) / o.api_requests) * 100)}%` : o ? 'No traffic' : '—';
      return [
        { label: 'Total Registered Animals', value: v(o?.animals), icon: 'albums-outline', to: 'reports', tone: 'green' },
        { label: 'Cattle', value: v(o?.cattle), icon: 'paw-outline', to: 'reports', tone: 'green' },
        { label: 'Buffalo', value: v(o?.buffalo), icon: 'paw-outline', to: 'reports', tone: 'blue' },
        { label: 'Active Animals', value: v(o?.active), icon: 'pulse-outline', to: 'reports', tone: 'green' },
        { label: 'Registered Organisations', value: v(o?.organisations), icon: 'business-outline', to: 'users', tone: 'slate' },
        { label: 'Registered Farmers', value: v(o?.farmers), icon: 'leaf-outline', to: 'users', tone: 'green' },
        { label: 'Active Field Workers', value: v(o?.field_workers), icon: 'walk-outline', to: 'users', tone: 'blue' },
        { label: 'Biometric Identification Requests', value: v(o?.identifications), icon: 'finger-print-outline', to: 'audit', tone: 'violet' },
        { label: 'Failed Identification Attempts', value: v(o?.failed_identifications), icon: 'close-circle-outline', to: 'audit', tone: 'red' },
        { label: 'Pending Synchronisation', value: fmt(input.pendingSync), icon: 'cloud-upload-outline', to: 'sync', tone: 'amber' },
        { label: 'API Health', value: apiHealth, icon: 'code-slash-outline', to: 'api', tone: 'slate' },
        { label: 'System Alerts', value: v((o?.security_events ?? 0) + (o?.failed_logins ?? 0)), icon: 'warning-outline', to: 'security', tone: 'red', hint: 'Denied + failed logins, 7 days' },
      ];
    }
    case 'Organisation Administrator': {
      const farmers = new Set(approved.map((animal) => animal.owner_user_id ?? animal.owner_name).filter(Boolean)).size;
      const farms = new Set(approved.map((animal) => animal.farm_id).filter(Boolean)).size;
      const thisMonth = records.filter((record) => record.date.slice(0, 7) === new Date().toISOString().slice(0, 7)).length;
      return [
        { label: 'Animals in Organisation', value: fmt(approved.length), icon: 'albums-outline', to: 'records', tone: 'green' },
        { label: 'Active Farmers', value: fmt(farmers), icon: 'leaf-outline', to: 'users', tone: 'green' },
        { label: 'Registered Farms', value: fmt(farms), icon: 'home-outline', to: 'records', tone: 'blue' },
        { label: 'Field Workers', value: input.staffCount === null ? '—' : fmt(input.staffCount), icon: 'people-outline', to: 'users', tone: 'blue' },
        { label: 'Services Completed', value: fmt(records.length), icon: 'medkit-outline', to: 'services-health', tone: 'green' },
        { label: 'Pending Approvals', value: fmt(pendingReviews.length + openRequests.length), icon: 'checkmark-done-outline', to: 'approvals', tone: 'amber' },
        { label: 'Data Synchronisation', value: input.pendingSync === 0 ? 'Up to date' : `${input.pendingSync} queued`, icon: 'sync-outline', to: 'sync', tone: input.pendingSync ? 'amber' : 'green' },
        { label: 'Monthly Reports', value: `${thisMonth} services`, icon: 'bar-chart-outline', to: 'reports', tone: 'slate', hint: 'This month' },
      ];
    }
    case 'Government Officer': {
      const villages = new Set(approved.map((animal) => animal.village)).size;
      const breeds = new Set(approved.map((animal) => animal.breed)).size;
      return [
        { label: 'Registered Cattle', value: fmt(cattle), icon: 'paw-outline', to: 'records', tone: 'green' },
        { label: 'Registered Buffalo', value: fmt(buffalo), icon: 'paw-outline', to: 'records', tone: 'blue' },
        { label: 'District-wise Coverage', value: `${villages} villages`, icon: 'map-outline', to: 'reports', tone: 'slate' },
        { label: 'Breed-wise Coverage', value: `${breeds} breeds`, icon: 'git-branch-outline', to: 'reports', tone: 'violet' },
        { label: 'Animal Identification Activity', value: input.myIdentificationsToday === null ? '—' : `${input.myIdentificationsToday} today`, icon: 'finger-print-outline', to: 'audit', tone: 'blue' },
        { label: 'Veterinary Services', value: fmt(records.filter((r) => r.service_type === 'health').length), icon: 'medkit-outline', to: 'services-health', tone: 'green' },
        { label: 'AI Services', value: fmt(records.filter((r) => r.service_type === 'ai').length), icon: 'flask-outline', to: 'services-ai', tone: 'blue' },
        { label: 'Traceability Events', value: fmt(records.filter((r) => r.service_type === 'traceability').length), icon: 'navigate-outline', to: 'services-traceability', tone: 'amber' },
        { label: 'Pending Programme Reports', value: fmt(openRequests.length + pendingReviews.length), icon: 'clipboard-outline', to: 'approvals', tone: 'amber' },
      ];
    }
    case 'Veterinarian': {
      const seenToday = new Set(mine.filter((record) => isToday(record.created_at)).map((record) => record.animal_id)).size;
      const help = requests.filter((request) => request.kind === 'vet_help');
      return [
        { label: 'Animals Seen Today', value: fmt(seenToday), icon: 'today-outline', to: 'services-health', tone: 'green' },
        { label: 'Scheduled Visits', value: fmt(help.filter((r) => r.status === 'Accepted').length), icon: 'calendar-outline', to: 'approvals', tone: 'blue' },
        { label: 'Pending Treatments', value: fmt(help.filter((r) => r.status === 'Submitted').length), icon: 'bandage-outline', to: 'approvals', tone: 'amber' },
        { label: 'Vaccinations Due', value: fmt(due.length), icon: 'shield-checkmark-outline', to: 'records', tone: 'amber' },
        { label: 'Follow-up Cases', value: fmt(followUpsDue(records).length), icon: 'refresh-outline', to: 'services-health', tone: 'blue' },
        { label: 'Emergency Alerts', value: fmt(notifications.filter((n) => n.type === 'alert' && !n.read).length), icon: 'warning-outline', to: 'notifications', tone: 'red' },
      ];
    }
    case 'AI Technician': {
      const ai = mine.filter((record) => record.service_type === 'ai');
      return [
        { label: "Today's Visits", value: fmt(new Set(mine.filter((r) => isToday(r.created_at)).map((r) => r.animal_id)).size), icon: 'walk-outline', to: 'services-ai', tone: 'green' },
        { label: 'Animals Identified', value: input.myIdentificationsToday === null ? '—' : fmt(input.myIdentificationsToday), icon: 'finger-print-outline', to: 'audit', tone: 'blue', hint: 'Today' },
        { label: 'AI Services Completed', value: fmt(ai.length), icon: 'flask-outline', to: 'services-ai', tone: 'green' },
        { label: 'Pending Follow-ups', value: fmt(requests.filter((r) => r.kind === 'ai_service' && (r.status === 'Submitted' || r.status === 'Accepted')).length), icon: 'refresh-outline', to: 'approvals', tone: 'amber' },
        { label: 'Pregnancy Checks Due', value: fmt(pregnancyChecksDue(animals, records).length), icon: 'heart-outline', to: 'services-ai', tone: 'violet' },
        { label: 'Offline Records Waiting for Sync', value: fmt(input.pendingSync), icon: 'cloud-upload-outline', to: 'sync', tone: input.pendingSync ? 'amber' : 'slate' },
      ];
    }
    case 'Farmer': {
      const followUps = pregnancyChecksDue(animals, records).length + requests.filter((r) => r.kind === 'ai_service' && r.status !== 'Completed' && r.status !== 'Declined').length;
      return [
        { label: 'My Cattle', value: fmt(cattle), icon: 'paw-outline', to: 'records', tone: 'green' },
        { label: 'My Buffalo', value: fmt(buffalo), icon: 'paw-outline', to: 'records', tone: 'blue' },
        { label: 'Vaccinations Due', value: fmt(due.length), icon: 'shield-checkmark-outline', to: 'services-health', tone: 'amber' },
        { label: 'Upcoming Breeding Follow-ups', value: fmt(followUps), icon: 'heart-outline', to: 'services-ai', tone: 'violet' },
        { label: 'Veterinary Visits', value: fmt(records.filter((r) => r.service_type === 'health').length), icon: 'medkit-outline', to: 'services-health', tone: 'green' },
        { label: 'Recent Animal Activity', value: fmt(records.filter((r) => withinDays(r.date, 30)).length), icon: 'time-outline', to: 'notifications', tone: 'slate', hint: 'Last 30 days' },
      ];
    }
    case 'Farm Manager': {
      const attention = new Set([...due.map((a) => a.id), ...pendingReviews.map((a) => a.id), ...requests.filter((r) => r.status === 'Submitted').map((r) => r.animal_id ?? '')]);
      attention.delete('');
      return [
        { label: 'Total Farm Animals', value: fmt(approved.length), icon: 'albums-outline', to: 'records', tone: 'green' },
        { label: 'Cattle', value: fmt(cattle), icon: 'paw-outline', to: 'records', tone: 'green' },
        { label: 'Buffalo', value: fmt(buffalo), icon: 'paw-outline', to: 'records', tone: 'blue' },
        { label: 'Animals Requiring Attention', value: fmt(attention.size), icon: 'alert-circle-outline', to: 'records', tone: 'red' },
        { label: 'Scheduled Services', value: fmt(requests.filter((r) => (r.kind === 'vet_help' || r.kind === 'ai_service') && (r.status === 'Submitted' || r.status === 'Accepted')).length), icon: 'calendar-outline', to: 'requests', tone: 'blue' },
        { label: 'Health and Vaccination Tasks', value: fmt(due.length), icon: 'medkit-outline', to: 'services-health', tone: 'amber' },
        { label: 'Breeding Activities', value: fmt(records.filter((r) => r.service_type === 'ai' && withinDays(r.date, 90)).length), icon: 'heart-outline', to: 'services-ai', tone: 'violet', hint: 'Last 90 days' },
      ];
    }
    case 'Insurance Officer':
      return [
        { label: 'Animals Pending Verification', value: fmt(policies.filter((p) => p.verification_status === 'Pending').length), icon: 'hourglass-outline', to: 'verify', tone: 'amber' },
        { label: 'Identity Checks Completed', value: fmt(records.filter((r) => r.record_type === 'Identity Verification').length), icon: 'shield-checkmark-outline', to: 'services-insurance', tone: 'green' },
        { label: 'Policies Linked', value: fmt(policies.length), icon: 'document-text-outline', to: 'records', tone: 'blue' },
        { label: 'Pending Claims', value: fmt(policies.filter((p) => p.claim_status === 'Claim Submitted' || p.claim_status === 'Under Verification').length), icon: 'cash-outline', to: 'verify', tone: 'violet' },
        { label: 'Verification Exceptions', value: fmt(policies.filter((p) => p.verification_status === 'Mismatch' || p.verification_status === 'Manual Review' || p.verification_status === 'Exception').length), icon: 'warning-outline', to: 'verify', tone: 'red' },
      ];
    case 'Livestock Inspector': {
      const inspected = new Set(records.filter((r) => r.service_type === 'traceability' && withinDays(r.date, 180)).map((r) => r.animal_id));
      return [
        { label: 'Scheduled Inspections', value: fmt(approved.filter((a) => a.current_status === 'Active' && !inspected.has(a.id)).length), icon: 'clipboard-outline', to: 'records', tone: 'blue', hint: 'Not inspected in 180 days' },
        { label: 'Animals Verified', value: input.myIdentificationsToday === null ? '—' : fmt(input.myIdentificationsToday), icon: 'finger-print-outline', to: 'audit', tone: 'green', hint: 'Today' },
        { label: 'Movement Events', value: fmt(records.filter((r) => r.service_type === 'traceability').length), icon: 'navigate-outline', to: 'services-traceability', tone: 'amber' },
        { label: 'Ownership Transfers Pending', value: fmt(requests.filter((r) => r.kind === 'transfer' && r.status === 'Submitted').length), icon: 'swap-horizontal-outline', to: 'approvals', tone: 'violet' },
        { label: 'Traceability Exceptions', value: fmt(animals.filter((a) => a.duplicate_of).length + requests.filter((r) => r.kind === 'correction' && r.status === 'Submitted').length), icon: 'warning-outline', to: 'approvals', tone: 'red' },
      ];
    }
    case 'Field Worker': {
      const created = animals.filter((animal) => animal.created_by === input.userId);
      return [
        { label: 'Assigned Visits', value: `${input.farmCount} farm${input.farmCount === 1 ? '' : 's'}`, icon: 'home-outline', to: 'records', tone: 'green' },
        { label: 'Animals to Register', value: fmt(created.filter((a) => a.approval_status === 'Rejected').length), icon: 'add-circle-outline', to: 'register', tone: 'blue', hint: 'Rejected, need re-capture' },
        { label: 'Images Awaiting Review', value: fmt(created.filter((a) => a.approval_status === 'Submitted' || a.approval_status === 'Pending Review').length), icon: 'images-outline', to: 'records', tone: 'amber' },
        { label: 'Incomplete Forms', value: fmt(created.filter((a) => a.approval_status === 'Draft').length), icon: 'document-outline', to: 'records', tone: 'slate' },
        { label: 'Records Waiting for Sync', value: fmt(input.pendingSync), icon: 'cloud-upload-outline', to: 'sync', tone: input.pendingSync ? 'amber' : 'slate' },
      ];
    }
    case 'Researcher': {
      const rows = input.research;
      const breeds = rows ? new Set(rows.map((row) => row.breed)).size : 0;
      const good = rows ? rows.filter((row) => row.quality_score >= 0.85).length : 0;
      const trials = input.validationTrials;
      const far = trials.length ? (trials.reduce((sum, t) => sum + t.far, 0) / trials.length).toFixed(2) : null;
      const frr = trials.length ? (trials.reduce((sum, t) => sum + t.frr, 0) / trials.length).toFixed(2) : null;
      return [
        { label: 'Dataset Size', value: rows ? fmt(rows.length) : '—', icon: 'server-outline', to: 'research', tone: 'violet' },
        { label: 'Breed Coverage', value: rows ? `${breeds} breeds` : '—', icon: 'git-branch-outline', to: 'research', tone: 'green' },
        { label: 'Image Quality Distribution', value: rows && rows.length ? `${Math.round((good / rows.length) * 100)}% ≥ 0.85` : '—', icon: 'images-outline', to: 'research', tone: 'blue' },
        { label: 'Validation Progress', value: `${trials.length} trial${trials.length === 1 ? '' : 's'}`, icon: 'flask-outline', to: 'performance', tone: 'amber' },
        { label: 'FAR / FRR Results', value: far && frr ? `${far}% / ${frr}%` : 'No trials yet', icon: 'stats-chart-outline', to: 'performance', tone: 'slate' },
        { label: 'Recognition Latency', value: 'Not measured', icon: 'timer-outline', to: 'performance', tone: 'slate', hint: 'No on-device model yet' },
      ];
    }
    case 'API Administrator': {
      const logs = input.apiLogs;
      const v = (n: number) => (logs ? fmt(n) : '—');
      return [
        { label: 'API Requests', value: v(logs?.length ?? 0), icon: 'swap-vertical-outline', to: 'api', tone: 'slate' },
        { label: 'Successful Requests', value: v(logs?.filter((l) => l.status_code < 400).length ?? 0), icon: 'checkmark-circle-outline', to: 'api', tone: 'green' },
        { label: 'Failed Requests', value: v(logs?.filter((l) => l.status_code >= 400).length ?? 0), icon: 'close-circle-outline', to: 'api', tone: 'red' },
        { label: 'Integration Status', value: `${input.activeClients} active`, icon: 'apps-outline', to: 'api', tone: 'blue' },
        { label: 'Authentication Failures', value: v(logs?.filter((l) => l.status_code === 401).length ?? 0), icon: 'lock-closed-outline', to: 'api', tone: 'amber' },
        { label: 'Synchronisation Errors', value: v(logs?.filter((l) => l.endpoint.includes('sync') && l.status_code >= 400).length ?? 0), icon: 'sync-outline', to: 'api', tone: 'amber' },
      ];
    }
    default:
      return [];
  }
}
