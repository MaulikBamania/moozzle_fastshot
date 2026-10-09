export type AnimalType = 'Cattle' | 'Buffalo';
export type Sex = 'Female' | 'Male';
export type BiometricStatus = 'Enrolled' | 'Pending Quality' | 'Retired';
export type AnimalStatus = 'Active' | 'Retired';
export type Language = 'EN' | 'HI' | 'GU';

export type LivestockRecordType =
  | 'Artificial Insemination'
  | 'Vaccination'
  | 'Treatment'
  | 'Pregnancy Diagnosis'
  | 'Calving'
  | 'Insurance Verification'
  | 'Movement';

export type ServiceType = 'health' | 'ai' | 'insurance' | 'traceability';
export type UserRole = 'AI Technician' | 'Vet' | 'Farmer' | 'Field Officer';
export const USER_ROLES: UserRole[] = ['AI Technician', 'Vet', 'Farmer', 'Field Officer'];

/** Row shapes as stored in Supabase. */
export interface AnimalRow {
  id: string;
  user_id: string;
  moozzle_id: string;
  species: 'cattle' | 'buffalo';
  breed: string;
  sex: 'female' | 'male';
  age_years: number;
  owner_name: string;
  owner_phone: string;
  farm_name: string;
  village: string;
  district: string;
  state: string;
  biometric_status: 'enrolled' | 'pending_quality' | 'retired';
  status: 'active' | 'retired';
  retire_reason: string | null;
  retired_at: string | null;
  captured_images_count: number;
  created_at: string;
  updated_at: string;
}

export interface BiometricTemplateRow {
  id: string;
  user_id: string;
  animal_id: string;
  moozzle_id: string;
  quality_score: number;
  embedding_preview: string;
  model_version: string;
  created_at: string;
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
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string;
  village: string;
}

/** App-facing animal, derived from an AnimalRow (plus its template). */
export interface Animal {
  id: string;
  moozzle_id: string;
  animal_type: AnimalType;
  breed: string;
  sex: Sex;
  age_years: number;
  owner_name: string;
  owner_phone: string;
  farm_name: string;
  village: string;
  district: string;
  state: string;
  registration_date: string;
  biometric_status: BiometricStatus;
  current_status: AnimalStatus;
  retire_reason?: string;
  retire_date?: string;
  captured_images_count: number;
  biometric_template_id: string;
  created_at: string;
  updated_at: string;
  /** True while the record only exists in the offline queue. */
  pending_sync?: boolean;
}

export interface BiometricTemplate {
  template_id: string;
  animal_id: string;
  moozzle_id: string;
  quality_score: number;
  model_version: string;
  embedding_preview: string;
  created_at: string;
}

export interface LivestockServiceRecord {
  id: string;
  animal_id: string;
  service_type: ServiceType;
  record_type: LivestockRecordType | string;
  date: string;
  performed_by: string;
  details: string;
  metadata: Record<string, string>;
  pending_sync?: boolean;
}

/** Writes waiting in the on-device queue until the next sync. */
export type QueuedOperation =
  | { kind: 'animal'; opId: string; userId: string; queuedAt: string; animal: Omit<AnimalRow, 'created_at' | 'updated_at'> & { created_at: string }; template: Omit<BiometricTemplateRow, 'created_at'> & { created_at: string } }
  | { kind: 'service'; opId: string; userId: string; queuedAt: string; record: Omit<ServiceRecordRow, 'created_at'> & { created_at: string } }
  | { kind: 'retire'; opId: string; userId: string; queuedAt: string; animalId: string; reason: string; retiredAt: string };

export interface SyncSummary {
  recordsUploaded: number;
  imagesUploaded: number;
  errors: number;
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
