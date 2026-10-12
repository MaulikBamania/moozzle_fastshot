import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import createQr from 'qrcode-generator';
import { getAnimalImageSource, formatMoozzleId } from '@/components/moozzle-ui';
import { formatAge } from '@/lib/age';
import { signedCaptureUrl } from '@/lib/biometric/engine';
import { remoteDataUrl } from '@/lib/certificate/data-url';
import { assetDataUrl, enhanceMuzzlePattern, exportCertificatePdf, type CertificateExportOutcome } from '@/lib/certificate/platform';
import { buildCertificateHtml, type CertificateData, type CertificateMuzzleFrame } from '@/lib/certificate/template';
import { supabase } from '@/lib/supabase';
import type { Animal, LivestockServiceRecord } from '@/store/types';

const LOGO: number = require('../../assets/images/moozzle-splash-logo.png');

export type { CertificateExportOutcome };

export interface CertificateInput {
  animal: Animal;
  /** Service records already limited by RLS to what the active role may read. */
  records: LivestockServiceRecord[];
  canViewHealth: boolean;
  organisationName: string | null;
  currentUser: { id: string | null; name: string; role: string | null };
  online: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** dd-mm-yyyy, as on the reference certificate. */
function formatDate(date: Date | null): string {
  return date ? `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}` : '—';
}

function formatTime(date: Date | null): string {
  if (!date) return '—';
  const hours = date.getHours();
  return `${pad(hours % 12 || 12)}:${pad(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Accepts YYYY-MM-DD (as entered in record forms) or any ISO value. */
function formatLooseDate(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '—';
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const parsed = validDate(trimmed);
  return parsed ? formatDate(parsed) : trimmed;
}

const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_match, lead: string, char: string) => lead + char.toUpperCase());

function statusLabel(value: string | null): string {
  if (!value || value === 'NA') return 'NA';
  return titleCase(value);
}

function bovineSpecies(type: Animal['animal_type']): string {
  return type === 'Buffalo' ? 'Buffalo' : 'Cattle';
}

function healthSummary(input: CertificateInput) {
  const { animal } = input;
  const milking = statusLabel(animal.production_status);
  const pregnancy = statusLabel(animal.pregnancy_status);
  if (!input.canViewHealth) return { milking, pregnancy, lastVaccination: 'Restricted', nextDue: 'Restricted', status: 'Restricted' };
  const health = input.records.filter((record) => record.service_type === 'health' && !record.corrected_by);
  const byDateDesc = (a: LivestockServiceRecord, b: LivestockServiceRecord) => b.date.localeCompare(a.date);
  const vaccination = health.filter((record) => record.record_type === 'Vaccination').sort(byDateDesc)[0];
  const latestTreatment = health.filter((record) => record.record_type === 'Treatment').sort(byDateDesc)[0];
  const treatmentDate = validDate(latestTreatment?.date);
  const underTreatment = !!treatmentDate && Date.now() - treatmentDate.getTime() < 30 * 24 * 3600 * 1000;
  return {
    milking,
    pregnancy,
    lastVaccination: vaccination ? formatLooseDate(vaccination.date) : 'Not recorded',
    nextDue: vaccination ? formatLooseDate(vaccination.metadata.next_due) : 'Not recorded',
    status: underTreatment ? 'Under Treatment' : 'Healthy',
  };
}

async function registeredByName(input: CertificateInput): Promise<string> {
  const { animal, currentUser } = input;
  if (animal.created_by && animal.created_by === currentUser.id) return currentUser.role ? `${currentUser.name} (${currentUser.role})` : currentUser.name;
  if (!animal.created_by) return '—';
  const { data, error } = await supabase.from('profiles').select('full_name, active_role').eq('id', animal.created_by).maybeSingle();
  if (error) {
    console.warn('Registrar lookup failed', error);
    return '—';
  }
  const row = data as { full_name?: string; active_role?: string | null } | null;
  if (!row?.full_name) return '—';
  return row.active_role ? `${row.full_name} (${row.active_role})` : row.full_name;
}

/** Inlines a private capture; returns null if the role cannot read it or it is missing. */
async function captureDataUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  try {
    return await remoteDataUrl(await signedCaptureUrl(path));
  } catch (caught) {
    console.warn('Muzzle capture unavailable for certificate', caught);
    return null;
  }
}

/** Front/left/right frames come from enrolment order; templates are only listed for privileged roles. */
async function muzzleFrames(animal: Animal): Promise<CertificateMuzzleFrame[]> {
  const { data, error } = await supabase.from('biometric_templates').select('image_path, frame_index').eq('animal_id', animal.id).not('image_path', 'is', null).order('frame_index', { ascending: true }).limit(3);
  if (error) console.warn('Template frames unavailable for certificate', error);
  const listed = ((data ?? []) as { image_path: string | null }[]).map((row) => row.image_path).filter((path): path is string => !!path);
  const paths = listed.length ? listed : [animal.reference_image_path];
  const [front, left, right] = await Promise.all([0, 1, 2].map((index) => captureDataUrl(paths[index])));
  const reference = front ?? (await captureDataUrl(animal.reference_image_path));
  let processed: string | null = null;
  let enhance = false;
  if (reference) {
    try {
      processed = await enhanceMuzzlePattern(reference);
    } catch (caught) {
      console.warn('Muzzle enhancement failed', caught);
    }
    if (!processed) {
      processed = reference;
      enhance = true;
    }
  }
  return [
    { label: 'Front View', src: front ?? reference },
    { label: 'Left View', src: left },
    { label: 'Right View', src: right },
    { label: 'Processed Muzzle Pattern', src: processed, enhance },
  ];
}

async function optionalAsset(moduleId: number): Promise<string | null> {
  try {
    return await assetDataUrl(moduleId);
  } catch (caught) {
    console.warn('Certificate asset could not be embedded', caught);
    return null;
  }
}

function qrSvg(text: string): string {
  const qr = createQr(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

export function certificateFileName(moozzleId: string): string {
  return `MOOZZLE_Certificate_${moozzleId}.pdf`;
}

/** Collects the record, embeds images and the QR code, and returns the printable HTML. */
export async function buildCertificate(input: CertificateInput): Promise<string> {
  const { animal } = input;
  const registeredAt = validDate(animal.device_registered_at) ?? validDate(animal.registration_date);
  const verifyUrl = Linking.createURL('/verify', { queryParams: { id: animal.moozzle_id } });
  const [logo, animalPhoto, muzzle, registeredBy] = await Promise.all([
    optionalAsset(LOGO),
    optionalAsset(getAnimalImageSource(animal.animal_type, animal.breed)),
    muzzleFrames(animal),
    registeredByName(input),
  ]);
  const dairy = animal.dairy_society_member;
  const ownerVisible = animal.owner_visible;
  const gps = animal.gps;
  const now = new Date();
  const data: CertificateData = {
    moozzleId: animal.moozzle_id,
    formattedId: formatMoozzleId(animal.moozzle_id),
    species: animal.animal_type,
    bovineSpecies: bovineSpecies(animal.animal_type),
    breed: animal.breed,
    age: formatAge(animal.age_years, animal.age_months),
    ageGroup: animal.age_group ? titleCase(animal.age_group) : '—',
    sex: animal.sex,
    production: statusLabel(animal.production_status),
    pregnancy: statusLabel(animal.pregnancy_status),
    dairyMember: dairy === null ? (ownerVisible ? 'Not recorded' : 'Restricted') : dairy ? 'Yes' : 'No',
    societyName: dairy ? animal.society_name : 'NA',
    societyCode: dairy ? animal.society_code : 'NA',
    memberCode: dairy ? animal.member_code : 'NA',
    recordStatus: animal.approval_status,
    logo,
    animalPhoto,
    qrSvg: qrSvg(verifyUrl),
    owner: ownerVisible
      ? { name: animal.owner_name || '—', mobile: animal.owner_phone || '—', address: [animal.village, animal.district, animal.state].filter(Boolean) }
      : { name: 'Restricted', mobile: 'Restricted', address: [[animal.district, animal.state].filter(Boolean).join(', ')].filter(Boolean) },
    registration: {
      date: formatDate(registeredAt),
      time: formatTime(registeredAt),
      registeredBy,
      organisation: input.organisationName || animal.farm_name || '—',
    },
    gps: gps
      ? {
          latitude: gps.latitude.toFixed(4),
          longitude: gps.longitude.toFixed(4),
          accuracy: gps.accuracy === null ? '—' : `${Math.round(gps.accuracy)} m`,
          captured: (() => {
            const at = validDate(gps.capturedAt);
            return at ? `${formatDate(at)} ${formatTime(at)}` : '—';
          })(),
          address: [animal.village, animal.district, animal.state].filter(Boolean).join(', '),
        }
      : null,
    health: healthSummary(input),
    muzzle,
    additional: {
      version: Constants.expoConfig?.version ?? '1.0.1',
      deviceId: 'MZ-APP-001',
      network: animal.pending_sync ? 'Offline (pending sync)' : input.online ? 'Online' : 'Offline',
      source: 'Mobile App',
    },
    generatedAt: `${formatDate(now)} ${formatTime(now)}`,
  };
  return buildCertificateHtml(data);
}

/** Builds and exports the PDF: share sheet on iOS/Android, direct file download on web. */
export async function downloadCertificate(input: CertificateInput): Promise<CertificateExportOutcome> {
  const html = await buildCertificate(input);
  return exportCertificatePdf(html, certificateFileName(input.animal.moozzle_id));
}
