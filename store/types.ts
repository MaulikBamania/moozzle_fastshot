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
  /** Capture angle per frame; absent on records queued before angle-guided capture. */
  capture_angles?: CaptureAngle[];
  quality_scores: number[];
  quality_metrics: QualityMetrics[];
  save_as_draft: boolean;
  source: string;
  /** Template model that produced the embeddings; the server rejects a mismatch with production. */
  model?: string;
  /** Explicit operator submission of a possible duplicate for manual review (never automatic). */
  duplicate_review_ack?: boolean;
  duplicate_review_note?: string;
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
  | 'MOVE CLOSER — FILL OVAL WITH MUZZLE'
  | 'MUZZLE SURFACE CONTAMINATED — WIPE & RETAKE'
  | 'HARSH FLASH GLARE — USE TORCH OR SHADE NOSE'
  | 'TOO BLURRY — RETAKE'
  | 'TOO DARK — IMPROVE LIGHTING'
  | 'TOO BRIGHT — REDUCE GLARE'
  | 'MUZZLE OBSTRUCTED — CLEAR THE NOSE'
  | 'RESOLUTION TOO LOW — RETAKE'
  | 'MUZZLE NOT DETECTED'
  | 'PATTERN NOT CLEAR — RETAKE';

/** Specific pre-comparison quality failure causes (Failure to Acquire), reported separately from matching errors. */
export type QualityReason =
  | 'muzzle_not_detected'
  | 'too_far'
  | 'blur'
  | 'too_dark'
  | 'overexposed'
  | 'obstructed'
  | 'low_resolution'
  | 'pattern_not_visible'
  /** CONTAMINATED_SURFACE: water droplets, saliva/mucus, leaves, dirt/mud or a foreign object on the nose pad. */
  | 'surface_contaminant'
  /** FLASH_GLARE: point-source flash / specular saturation whiting out the moist dermal ridges. */
  | 'flash_glare';

/** How much of the animal the frame shows; a head or full-body photo is too far for muzzle biometrics. */
export type SubjectFraming = 'muzzle_closeup' | 'head' | 'full_body' | 'no_animal';

/** AI-classified foreign matter on the planum nasale. Any flag fails the quality pre-check. */
export interface SurfaceContaminants {
  waterDroplets: boolean;
  salivaMucus: boolean;
  debris: boolean;
  foreignObject: boolean;
  description: string | null;
}

/** Field capture condition derived from measured lighting. */
export type CaptureCondition = 'normal' | 'low_light' | 'bright_glare';

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
  contaminants: SurfaceContaminants;
  /** AI saw harsh point-source flash / specular whiteout on the nose pad. */
  flashGlare: boolean;
  framing: SubjectFraming;
  notes: string;
}

export interface QualityMetrics {
  brightness: number;
  contrast: number;
  sharpness: number;
  overexposed: number;
  fill: number;
  /** Share of crop pixels that are near-saturated point highlights well above their surroundings (flash glare). */
  specular?: number;
}

export interface MuzzleAnalysis {
  status: QualityStatus;
  /** Every failed check, most important first; empty when the frame is accepted. */
  reasons: QualityReason[];
  hint: string;
  /** Source image size before normalisation. */
  sourceWidth: number;
  sourceHeight: number;
  condition: CaptureCondition;
  /** 'camera' for a live capture, 'upload' for a library photo. */
  source: CaptureSource;
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
export type CaptureSource = 'camera' | 'upload';
/** Why the server reached its outcome. */
export type DecisionReason = 'accepted' | 'between_thresholds' | 'ambiguous_margin' | 'below_review_threshold';
/** Data tier of a scan: controlled lab benchmark, field pilot, or production operation. */
export type DataSource = 'laboratory' | 'field_pilot' | 'production';

/** The five user-facing outcomes of a biometric attempt. */
export type BiometricDecision =
  | 'MATCH_CONFIRMED'
  | 'REVIEW_REQUIRED'
  | 'NO_ACCEPTED_MATCH'
  | 'IMAGE_QUALITY_INSUFFICIENT'
  | 'SERVICE_UNAVAILABLE';

export interface IdentifyResult {
  scan_id: string;
  outcome: MatchOutcome;
  decision_reason: DecisionReason;
  top_score: number;
  second_score: number | null;
  /** 1:N accept threshold of the production configuration. */
  match_threshold: number;
  review_threshold: number;
  margin: number;
  candidate_list_k: number;
  config_version: number;
  model_version: string;
  templates_searched: number;
  /** Enrolled animals (N) searched. */
  gallery_size: number;
  frames: number;
  data_source: DataSource;
  candidates: MatchCandidate[];
  image_path: string;
}

export interface VerifyResult {
  scan_id: string;
  outcome: MatchOutcome;
  decision_reason: DecisionReason;
  score: number;
  /** 1:1 accept threshold of the production configuration. */
  verify_threshold: number;
  review_threshold: number;
  config_version: number;
  model_version: string;
  data_source: DataSource;
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
  verify_review_threshold?: number;
  config_version?: number;
  scans: { total: number; match: number; no_match: number; uncertain: number; avg_ms: number | null };
}

// ---------- Scan analytics (FAR / FRR) ----------
export type GroundTruth = 'genuine' | 'impostor';
export type ScanType = 'identify' | 'verify' | 'enrol_check';
export type AnalyticsSpecies = 'Cattle' | 'Buffalo' | 'Crossbred';
export type ScanVerdict = 'True Match' | 'True Non-Match' | 'False Accept' | 'False Reject' | 'Unlabelled';

export interface ScanAnalyticsRow {
  id: string;
  created_at: string;
  scan_type: ScanType;
  outcome: MatchOutcome;
  similarity: number | null;
  quality_score: number | null;
  quality_status: string;
  processing_ms: number | null;
  templates_searched: number;
  frames: number;
  user_role: string;
  own: boolean;
  moozzle_id: string | null;
  animal_in_scope: boolean;
  species: AnalyticsSpecies | null;
  species_code: SpeciesCode | null;
  breed: string | null;
  age_group: AgeGroup | null;
  ground_truth: GroundTruth | null;
  ground_truth_note: string | null;
  labelled_at: string | null;
  decision_reason: DecisionReason | string;
  /** 1:N label: true when the searched animal was enrolled (mated search). */
  mated: boolean | null;
  /** 1-based rank of the true mate in the candidate list; null when absent or non-mated. */
  mate_rank: number | null;
  candidate_scores: number[];
  config_version: number | null;
  model_version: string | null;
  data_source: DataSource;
  test_session_id: string | null;
  device_model: string;
  capture_condition: string;
  review_status: 'none' | 'requested' | 'resolved';
  review_decision: ReviewDecision | null;
  can_label: boolean;
}

export type AcquisitionEventType = 'failure_to_acquire' | 'service_unavailable' | 'failure_to_enrol';
export type BiometricOperation = 'identify' | 'verify' | 'enrol';

export interface AcquisitionEventRow {
  id: string;
  created_at: string;
  operation: BiometricOperation;
  event_type: AcquisitionEventType;
  reason_code: string;
  quality_status: string;
  quality_score: number | null;
  frames_attempted: number;
  frames_accepted: number;
  device_model: string;
  capture_condition: string;
  model_version: string | null;
  config_version: number | null;
  data_source: DataSource;
  test_session_id: string | null;
}

export interface TestSessionRow {
  id: string;
  name: string;
  protocol_reference: string;
  data_source: Exclude<DataSource, 'production'>;
  dataset_split: 'calibration' | 'evaluation';
  device_model: string;
  capture_condition: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  own: boolean;
  created_role: string;
  subjects: string[];
  subject_count: number;
  /** Subjects that also appear in a session of the other split (leakage). */
  subject_overlap: number;
}

export interface ProductionConfig {
  config_version: number;
  model_version: string;
  verify_accept: number;
  verify_review: number;
  identify_accept: number;
  identify_review: number;
  identify_margin: number;
  candidate_list_k: number;
}

export interface ScanAnalyticsPayload {
  scope: 'own' | 'organisation' | 'platform';
  deidentified: boolean;
  since: string | null;
  config: ProductionConfig;
  match_threshold: number;
  review_threshold: number;
  verify_threshold: number;
  verify_review_threshold: number;
  gallery_size: number;
  scans: ScanAnalyticsRow[];
  acquisition_events: AcquisitionEventRow[];
  test_sessions: TestSessionRow[];
}

// ---------- Threshold governance ----------
export type ConfigStatus = 'proposed' | 'approved' | 'production' | 'rejected' | 'retired';

export interface BiometricConfigRow extends ProductionConfig {
  id: string;
  status: ConfigStatus;
  validation_reference: string;
  reason: string;
  proposed_by_name: string;
  proposed_role: string;
  proposed_at: string;
  own_proposal: boolean;
  approved_by_name: string | null;
  approved_at: string | null;
  approval_note: string | null;
  promoted_at: string | null;
  retired_at: string | null;
}

export interface ConfigAuditRow {
  id: string;
  config_version: number;
  action: 'seeded' | 'proposed' | 'approved' | 'rejected' | 'promoted' | 'retired';
  old_values: Partial<ProductionConfig> | null;
  new_values: Partial<ProductionConfig>;
  model_version: string;
  actor_name: string;
  actor_id: string | null;
  actor_role: string;
  reason: string;
  created_at: string;
}

export interface ConfigHistoryPayload {
  configs: BiometricConfigRow[];
  audit: ConfigAuditRow[];
  can_propose: boolean;
  can_approve: boolean;
}

// ---------- Manual review queue ----------
export type ReviewDecision = 'confirmed' | 'rejected' | 'inconclusive';

export interface ReviewCandidate extends MatchCandidate {
  rank: number;
  can_decide: boolean;
}

export interface ScanReviewItem {
  id: string;
  created_at: string;
  scan_type: ScanType;
  outcome: MatchOutcome;
  decision_reason: string;
  similarity: number | null;
  quality_score: number | null;
  frames: number;
  requester_role: string;
  config_version: number | null;
  model_version: string | null;
  data_source: DataSource;
  probe_image_path: string | null;
  review_status: 'requested' | 'resolved';
  review_note: string | null;
  review_decision: ReviewDecision | null;
  reviewed_at: string | null;
  review_resolution_note: string | null;
  review_confirmed_moozzle_id: string | null;
  candidates: ReviewCandidate[];
}

/** Capture angle recorded on every enrolment frame and biometric template. */
export type CaptureAngle = 'front' | 'left' | 'right' | 'additional';

/**
 * A frame rejected because it repeats an already-accepted frame. Never a quality failure:
 * the image itself may be fine, but enrolment needs distinct angles.
 */
export interface DuplicateFrameRejection {
  category: 'DUPLICATE_FRAME';
  /** Slot index (0-based) of the accepted frame that was matched. */
  matchedSlot: number;
  similarity: number;
  /** True when the normalised image bytes are identical, not only near-identical. */
  identical: boolean;
}
