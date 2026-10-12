import type { Level, Permission, Role, ServiceKind } from '@/lib/rbac';

export type AnimalType = 'Cattle' | 'Buffalo' | 'Crossbreed' | 'Bull' | 'Bullock';
/** Database species codes, one per AnimalType. */
export type SpeciesCode = 'cattle' | 'buffalo' | 'crossbreed' | 'bull' | 'bullock';
export type Sex = 'Female' | 'Male';
export type AgeGroup = 'CALF' | 'YOUNG' | 'ADULT';
/** Status I — animal production status. */
export type ProductionStatus = 'DRY' | 'MILK' | 'NA';
/** Status II — pregnancy status. */
export type PregnancyStatus = 'PREGNANT' | 'NON-PREGNANT' | 'NA';
export type YesNo = 'yes' | 'no';

/** A device GPS fix as reported by the operating system's location services. */
export interface GpsFix {
  latitude: number;
  longitude: number;
  /** Reported horizontal accuracy in metres; null when the OS does not report it. */
  accuracy: number | null;
  /** ISO UTC timestamp of when the fix was obtained. */
  capturedAt: string;
  mocked: boolean;
}
export type BiometricStatus = 'Enrolled' | 'Pending Quality' | 'Retired';
export type AnimalStatus = 'Active' | 'Retired';
export type ApprovalStatus = 'Draft' | 'Submitted' | 'Pending Review' | 'Approved' | 'Rejected' | 'Corrected' | 'Retired';
export type Language = 'EN' | 'HI' | 'GU';
export type ServiceType = ServiceKind;

/** Row shapes as stored in Supabase. */
export interface AnimalRow {
  id: string;
  user_id: string;
  moozzle_id: string;
  species: SpeciesCode;
  breed: string;
  sex: 'female' | 'male';
  age_years: number;
  /** 0-11; older rows default to 0. */
  age_months?: number;
  /** Server-derived from age + species thresholds. */
  age_group?: AgeGroup | null;
  /** Null on records registered before Status I existed. */
  production_status?: ProductionStatus | null;
  pregnancy_status?: PregnancyStatus | null;
  /** Device clock at registration (stored UTC) and its local UTC offset. */
  device_registered_at?: string | null;
  device_utc_offset_minutes?: number | null;
  farm_name: string;
  village: string;
  district: string;
  state: string;
  biometric_status: 'enrolled' | 'pending_quality' | 'retired';
  status: 'active' | 'retired';
  retire_reason: string | null;
  retired_at: string | null;
  captured_images_count: number;
  organisation_id: string | null;
  farm_id: string | null;
  owner_user_id: string | null;
  approval_status: ApprovalStatus;
  duplicate_of: string | null;
  review_note: string | null;
  reference_image_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerRow {
  animal_id: string;
  owner_name: string;
  owner_phone: string;
  /** Null on records registered before the dairy-society question existed. */
  dairy_society_member?: boolean | null;
  society_name?: string | null;
  society_code?: string | null;
  member_code?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  gps_accuracy_m?: number | null;
  gps_captured_at?: string | null;
}

export interface ServiceRecordRow {
  id: string;
  user_id: string;
  animal_id: string;
  service_type: ServiceType;
  title: string;
  date: string;
  technician_name: string;
  details: Record<string, string>;
  performer_role: string;
  corrects_id: string | null;
  signed_at: string;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  active_role: Role;
  phone: string;
  village: string;
  privileged_until: string | null;
  privileged_reason: string | null;
  notification_prefs: Record<string, boolean>;
}

export interface UserRoleRow {
  id: string;
  user_id: string;
  role: Role;
  organisation_id: string | null;
  farm_ids: string[];
  districts: string[];
  created_at: string;
}

export interface OrganisationRow {
  id: string;
  name: string;
  org_type: string;
  district: string;
  state: string;
}

export interface FarmRow {
  id: string;
  organisation_id: string | null;
  name: string;
  village: string;
  district: string;
  state: string;
}

export interface PolicyRow {
  id: string;
  animal_id: string;
  policy_number: string;
  insurer_org_id: string;
  holder_name: string;
  coverage_amount: number;
  start_date: string;
  end_date: string;
  claim_status: string;
  verification_status: 'Pending' | 'Verified' | 'Mismatch' | 'Manual Review' | 'Exception';
  last_verified_at: string | null;
}

export type RequestKind = 'transfer' | 'retire' | 'correction' | 'vet_help' | 'ai_service';
export type RequestStatus = 'Submitted' | 'Approved' | 'Rejected' | 'Accepted' | 'Declined' | 'Completed';

export interface RequestRow {
  id: string;
  kind: RequestKind;
  animal_id: string | null;
  moozzle_id: string;
  requested_by: string;
  requester_role: string;
  requester_name: string;
  payload: Record<string, string>;
  status: RequestStatus;
  reviewer_role: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  user_role: string;
  title: string;
  message: string;
  type: 'info' | 'alert' | 'approval' | 'reminder' | 'sync' | 'security' | 'integration';
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface AuditRow {
  id: string;
  event_id: string;
  user_id: string | null;
  user_role: string;
  action: string;
  target_moozzle_id: string;
  details: string;
  outcome: 'success' | 'denied' | 'failed' | 'no_match' | 'requested';
  reason: string;
  source: string;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string | number | boolean;
  description: string;
  risk: 'normal' | 'high';
  updated_at: string;
}

export interface PermissionRow {
  role: Role;
  permission: Permission;
  level: Level;
  updated_at: string;
}

/** App-facing animal, derived from an AnimalRow (+ owner data when authorised). */
export interface Animal {
  id: string;
  moozzle_id: string;
  animal_type: AnimalType;
  breed: string;
  sex: Sex;
  age_years: number;
  /** Months beyond whole years (0-11). */
  age_months: number;
  age_group: AgeGroup | null;
  production_status: ProductionStatus | null;
  pregnancy_status: PregnancyStatus | null;
  /** Device-local registration instant (ISO) and the device's UTC offset in minutes at that time. */
  device_registered_at: string | null;
  device_utc_offset_minutes: number | null;
  /** Owner-scoped: null when not visible to the active role or not recorded. */
  dairy_society_member: boolean | null;
  society_name: string;
  society_code: string;
  member_code: string;
  gps: { latitude: number; longitude: number; accuracy: number | null; capturedAt: string | null } | null;
  /** Empty when the active role is not authorised to see owner personal data. */
  owner_name: string;
  owner_phone: string;
  owner_visible: boolean;
  owner_user_id: string | null;
  farm_id: string | null;
  farm_name: string;
  organisation_id: string | null;
  village: string;
  district: string;
  state: string;
  registration_date: string;
  biometric_status: BiometricStatus;
  current_status: AnimalStatus;
  approval_status: ApprovalStatus;
  duplicate_of: string | null;
  review_note: string | null;
  retire_reason?: string;
  retire_date?: string;
  captured_images_count: number;
  /** Private storage path of the first enrolment muzzle frame. */
  reference_image_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** True while the record only exists in the offline queue. */
  pending_sync?: boolean;
}

export interface LivestockServiceRecord {
  id: string;
  animal_id: string;
  service_type: ServiceType;
  record_type: string;
  date: string;
  performed_by: string;
  performer_role: string;
  author_id: string;
  details: string;
  metadata: Record<string, string>;
  corrects_id: string | null;
  /** Set when a later signed amendment corrects this record. */
  corrected_by: string | null;
  created_at: string;
  pending_sync?: boolean;
}

export interface RegisterPayload {
  id: string;
  moozzle_id: string;
  species: SpeciesCode;
  breed: string;
  sex: 'female' | 'male';
  age_years: number;
  /** Optional so offline items queued before months existed still sync. */
  age_months?: number;
  /** Fields below are optional only so items queued before this release still parse; the server requires them. */
  age_group?: AgeGroup;
  production_status?: ProductionStatus;
  pregnancy_status?: PregnancyStatus;
  dairy_society?: YesNo;
  society_name?: string | null;
  society_code?: string | null;
  member_code?: string | null;
  gps_latitude?: number;
  gps_longitude?: number;
  gps_accuracy_m?: number | null;
  gps_captured_at?: string;
  gps_mocked?: boolean;
  device_registered_at?: string;
  device_utc_offset_minutes?: number;
  owner_name: string;
  owner_phone: string;
  farm_id: string | null;
  farm_name: string;
  village: string;
  district: string;
  state: string;
  captured_images_count: number;
  quality_score: number;
  /** pgvector literals of the accepted 256-D embeddings (3–5). */
  embeddings: string[];
  image_paths: string[];
  quality_scores: number[];
  quality_metrics: QualityMetrics[];
  save_as_draft: boolean;
  source: string;
}

export interface ServicePayload {
  id: string;
  animal_id: string;
  service_type: ServiceType;
  title: string;
  date: string;
  technician_name: string;
  details: Record<string, string>;
  corrects_id: string | null;
  source: string;
}

/** Writes waiting in the on-device queue. They are re-authorised by the server on upload. */
export type QueuedOperation =
  | { kind: 'animal'; opId: string; userId: string; role: Role; queuedAt: string; payload: RegisterPayload }
  | { kind: 'service'; opId: string; userId: string; role: Role; queuedAt: string; payload: ServicePayload; moozzleId: string };

export interface FailedOperation {
  operation: QueuedOperation;
  error: string;
  failedAt: string;
  revoked: boolean;
}

export interface SyncConflict {
  provisionalId: string;
  assignedId: string;
  note: string;
}

export interface SyncSummary {
  recordsUploaded: number;
  imagesUploaded: number;
  errors: number;
  revoked: number;
  conflicts: SyncConflict[];
  completedAt: string;
}

export interface ValidationTrial {
  id: string;
  location: string;
  date: string;
  breed: string;
  animal_type: AnimalType;
  animals_count: number;
  images_per_animal: number;
  verification_attempts: number;
  identification_attempts: number;
  correct_matches: number;
  false_acceptances: number;
  false_rejections: number;
  far: number;
  frr: number;
  accuracy: number;
  device_model: string;
  created_at: string;
}

export interface Preferences {
  [key: string]: unknown;
}

// ---------- Live biometric engine ----------
export type QualityStatus =
  | 'GOOD IMAGE — READY TO SCAN'
  | 'MOVE CLOSER'
  | 'TOO BLURRY — RETAKE'
  | 'TOO DARK — IMPROVE LIGHTING'
  | 'MUZZLE NOT DETECTED'
  | 'PATTERN NOT CLEAR — RETAKE';

export type PipelineStage = 'normalize' | 'detect' | 'crop' | 'quality' | 'embed' | 'search';

export interface MuzzleDetection {
  muzzleDetected: boolean;
  species: 'cattle' | 'buffalo' | 'unknown';
  /** Normalised [x, y, width, height] of the muzzle in the frame, 0–1. */
  box: [number, number, number, number] | null;
  focus: 'sharp' | 'soft' | 'blurry';
  lighting: 'good' | 'dark' | 'glare';
  patternVisible: boolean;
  occlusion: 'none' | 'partial' | 'heavy';
  notes: string;
}

export interface QualityMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
  overexposed: number;
  fill: number;
}

export interface MuzzleAnalysis {
  status: QualityStatus;
  hint: string;
  qualityScore: number;
  metrics: QualityMetrics | null;
  detection: MuzzleDetection;
  /** Normalised L2 256-D texture embedding; null when the frame was rejected. */
  embedding: number[] | null;
  imageUri: string;
  imageBase64: string;
  cropUri: string | null;
  processingMs: number;
}

export interface MatchCandidate {
  animal_id?: string;
  in_scope: boolean;
  moozzle_id: string;
  species: SpeciesCode;
  breed?: string;
  sex?: 'female' | 'male';
  age_years?: number;
  age_months?: number;
  farm_name?: string;
  village?: string;
  reference_image_path?: string | null;
  score: number;
}

export type MatchOutcome = 'match' | 'no_match' | 'uncertain';

export interface IdentifyResult {
  scan_id: string;
  outcome: MatchOutcome;
  top_score: number;
  match_threshold: number;
  review_threshold: number;
  templates_searched: number;
  frames: number;
  candidates: MatchCandidate[];
  image_path: string;
}

export interface VerifyResult {
  scan_id: string;
  outcome: MatchOutcome;
  score: number;
  verify_threshold: number;
  review_threshold: number;
  templates_compared: number;
  animal: MatchCandidate;
}

export interface ValidationPayload {
  mode: 'overall' | 'cross_breed' | 'cross_lighting';
  templates: number;
  animals: number;
  /** [genuine 1 | impostor 0, cosine similarity, group label] */
  pairs: [number, number, string][];
  match_threshold: number;
  review_threshold: number;
  verify_threshold: number;
  scans: { total: number; match: number; no_match: number; uncertain: number; avg_ms: number | null };
}
