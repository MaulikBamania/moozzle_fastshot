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

export interface Animal {
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
  reference_muzzle_uri: string;
  captured_images_count: number;
  biometric_template_id: string;
  created_at: string;
  updated_at: string;
}

export interface BiometricTemplate {
  template_id: string;
  moozzle_id: string;
  quality_score: number;
  model_version: string;
  created_at: string;
}

export interface LivestockServiceRecord {
  id: string;
  moozzle_id: string;
  record_type: LivestockRecordType;
  date: string;
  performed_by: string;
  details: string;
  metadata: Record<string, string>;
}

export interface SyncQueue {
  animalRecords: number;
  muzzleImages: number;
  aiHealthEntries: number;
}

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
