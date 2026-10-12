import { bannerHerdSvg, iconSvg, mapPreviewSvg, pastureSvg, signatureSvg } from '@/lib/certificate/artwork';

/** A4 proportions (210 × 297 mm at 96 CSS px/in); one CSS px maps to one PDF unit on native. */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

export interface CertificateMuzzleFrame {
  label: string;
  /** Data URL of the enrolment frame, or null when this view was not captured / is not visible to the role. */
  src: string | null;
  /** Apply the ridge-and-groove enhancement with CSS (native print path). */
  enhance?: boolean;
}

export interface CertificateData {
  moozzleId: string;
  formattedId: string;
  species: string;
  bovineSpecies: string;
  breed: string;
  age: string;
  ageGroup: string;
  sex: string;
  production: string;
  pregnancy: string;
  dairyMember: string;
  societyName: string;
  societyCode: string;
  memberCode: string;
  recordStatus: string;
  logo: string | null;
  animalPhoto: string | null;
  qrSvg: string;
  owner: { name: string; mobile: string; address: string[] };
  registration: { date: string; time: string; registeredBy: string; organisation: string };
  gps: { latitude: string; longitude: string; accuracy: string; captured: string; address: string } | null;
  health: { milking: string; pregnancy: string; lastVaccination: string; nextDue: string; status: string };
  muzzle: CertificateMuzzleFrame[];
  additional: { version: string; deviceId: string; network: string; source: string };
  generatedAt: string;
}

const NAVY = '#14284b';
const GREEN = '#17733a';
const GREEN_DARK = '#0e5a2c';

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function rows(items: [string, string, boolean?][], labelWidth: number): string {
  return `<table class="rows">${items
    .map(([label, value, strong]) => `<tr><td class="lbl" style="width:${labelWidth}px">${esc(label)}</td><td class="sep">:</td><td class="val${strong ? ' strong' : ''}">${esc(value || '—')}</td></tr>`)
    .join('')}</table>`;
}

function heading(icon: Parameters<typeof iconSvg>[0], title: string, size = 20): string {
  return `<div class="head"><span class="ico">${iconSvg(icon, GREEN, size)}</span><span>${esc(title)}</span></div>`;
}

function image(src: string | null, className: string, fallback: string, style = ''): string {
  if (!src) return `<div class="${className} empty" style="${style}"><span>${esc(fallback)}</span></div>`;
  return `<div class="${className}" style="${style}background-image:url('${src}')"></div>`;
}

function logoBlock(logo: string | null, width: number): string {
  if (logo) return `<div class="logo" style="width:${width}px;height:${Math.round(width * 0.284)}px;background-image:url('${logo}')"></div>`;
  return `<div style="font:800 ${Math.round(width / 5.2)}px/1 Arial,sans-serif;color:${NAVY};letter-spacing:1px">MOOZZLE<sup style="font-size:9px">TM</sup><div style="font-size:${Math.round(width / 26)}px;letter-spacing:.5px">BOVINE MUZZLE BIOMETRIC IDENTIFICATION</div></div>`;
}

const STYLES = `
@page { size: ${PAGE_WIDTH}px ${PAGE_HEIGHT}px; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; background: #fff; }
body { font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1d2b36; font-size: 10.5px; }
#page { position: relative; width: ${PAGE_WIDTH}px; height: ${PAGE_HEIGHT}px; overflow: hidden; background: linear-gradient(180deg, #f3f8f4 0%, #ffffff 18%, #ffffff 82%, #f4f9f3 100%); padding: 0 22px; }
.bg { background-size: cover; background-position: center; background-repeat: no-repeat; }
.logo { background-size: contain; background-position: left center; background-repeat: no-repeat; }
.header { display: flex; align-items: center; height: 92px; padding: 0 22px; gap: 18px; }
.header .tag { border-left: 2.5px solid ${GREEN}; padding-left: 16px; color: ${NAVY}; font-size: 15.5px; font-weight: 600; line-height: 1.32; }
.header .right { margin-left: auto; border-left: 2.5px solid ${GREEN}; padding-left: 14px; color: ${GREEN}; font-size: 13.5px; font-weight: 500; line-height: 1.3; }
.banner { position: relative; height: 74px; border-radius: 12px; overflow: hidden; background: linear-gradient(100deg, ${GREEN_DARK} 0%, #1b7d3f 45%, #3aa155 70%, #7cc067 100%); display: flex; align-items: center; color: #fff; padding: 0 22px; }
.banner .id-label { font-size: 13px; font-weight: 600; letter-spacing: .4px; }
.banner .id { font-size: 27px; font-weight: 800; letter-spacing: 1.2px; line-height: 1.1; }
.banner .divider { width: 1.5px; height: 46px; background: rgba(255,255,255,.75); margin: 0 18px; }
.banner .slogan { font-size: 12.5px; font-weight: 600; line-height: 1.6; }
.banner .herd { position: absolute; right: 14px; bottom: 0; }
.grid { display: flex; gap: 10px; margin-top: 10px; }
.card { background: #f7fbf8; border: 1px solid #cfe3d6; border-radius: 9px; padding: 9px 12px; }
.head { display: flex; align-items: center; gap: 8px; color: ${GREEN}; font-size: 13.5px; font-weight: 700; margin-bottom: 6px; }
.ico { display: inline-flex; align-items: center; }
.rows { border-collapse: collapse; width: 100%; }
.rows td { padding: 2.6px 0; vertical-align: top; font-size: 10.5px; line-height: 1.3; }
.rows .lbl { color: #3a4752; }
.rows .sep { width: 14px; color: #3a4752; }
.rows .val { color: #13202b; font-weight: 500; }
.rows .strong { font-weight: 700; }
.photo { border-radius: 8px; border: 1px solid #cfe3d6; background-size: cover; background-position: center top; }
.empty { display: flex; align-items: center; justify-content: center; background: #eef4f0; color: #6a7a72; font-size: 9.5px; text-align: center; }
.qr { width: 150px; border: 2px solid ${GREEN_DARK}; border-radius: 8px; background: #fff; padding: 8px; text-align: center; color: ${GREEN_DARK}; }
.qr svg { width: 84px; height: 84px; display: block; margin: 0 auto; }
.qr .scan { font-size: 10.5px; font-weight: 600; margin-top: 4px; line-height: 1.35; }
.qr .qid { font-size: 13.5px; font-weight: 800; color: ${NAVY}; margin: 2px 0 4px; letter-spacing: .4px; }
.qr .verified { font-size: 9.5px; font-weight: 600; line-height: 1.35; }
.loc { display: flex; align-items: center; gap: 8px; margin-top: 6px; border-top: 1px dashed #cfe3d6; padding-top: 6px; }
.loc .txt { flex: 1; font-size: 9.5px; color: #3a4752; line-height: 1.35; }
.loc .txt b { color: ${GREEN}; font-size: 10px; }
.frames { display: flex; gap: 8px; }
.frame { flex: 1; text-align: center; font-size: 9px; font-weight: 600; color: #2a3a33; }
.frame .shot { height: 86px; border-radius: 6px; border: 1px solid #cfe3d6; background-size: cover; background-position: center; margin-bottom: 4px; }
.frame .enhance { filter: grayscale(1) contrast(2.4) brightness(1.08); }
.cert { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding: 11px 16px; }
.cert .title { color: ${GREEN}; font-size: 12.5px; font-weight: 800; letter-spacing: .3px; margin-bottom: 3px; }
.cert .body { font-size: 10.5px; line-height: 1.5; color: #24323c; }
.cert .meta { font-size: 9px; color: #5a6a62; margin-top: 4px; }
.sign { width: 160px; text-align: center; color: ${GREEN_DARK}; font-size: 10px; font-weight: 700; line-height: 1.35; }
.sign .line { border-top: 1.2px solid ${NAVY}; margin: 2px 6px 4px; }
.footer { position: absolute; left: 0; right: 0; bottom: 0; height: 156px; }
.footer .art { position: absolute; left: 0; right: 0; top: 0; height: 88px; }
.footer .bar { position: absolute; left: 22px; right: 22px; bottom: 10px; display: flex; align-items: flex-end; justify-content: space-between; }
.pillars { display: flex; align-items: center; gap: 8px; font-size: 9.5px; color: ${GREEN_DARK}; font-weight: 600; }
.pillars span { display: inline-flex; align-items: center; gap: 4px; }
.pillars i { width: 1px; height: 14px; background: ${NAVY}; display: inline-block; }
.brand { text-align: right; font-size: 10px; color: ${NAVY}; line-height: 1.4; }
.brand b { font-size: 11px; }
`;

/** Builds the single-page A4 "MOOZZLE Bovine Biometric Certificate" HTML document. */
export function buildCertificateHtml(data: CertificateData): string {
  const animalRows = rows(
    [
      ['MOOZZLE ID', data.moozzleId],
      ['Species', data.species],
      ['Bovine Species', data.bovineSpecies],
      ['Breed', data.breed],
      ['Age', data.age],
      ['Age Group', data.ageGroup],
      ['Sex', data.sex],
      ['Status I (Production)', data.production],
      ['Status II (Pregnancy)', data.pregnancy],
      ['Milk in Dairy Society', data.dairyMember],
      ['Society Name', data.societyName],
      ['Society Code', data.societyCode],
      ['Member Code', data.memberCode],
    ],
    128,
  );
  const ownerRows = `<table class="rows"><tr><td class="lbl" style="width:70px">Name</td><td class="sep">:</td><td class="val">${esc(data.owner.name)}</td></tr><tr><td class="lbl">Mobile</td><td class="sep">:</td><td class="val">${esc(data.owner.mobile)}</td></tr><tr><td class="lbl">Address</td><td class="sep">:</td><td class="val">${data.owner.address.map(esc).join('<br/>') || '—'}</td></tr></table>`;
  const gps = data.gps
    ? `${rows([['Latitude', data.gps.latitude], ['Longitude', data.gps.longitude], ['Accuracy', data.gps.accuracy], ['Location Captured', data.gps.captured]], 96)}
       <div class="loc"><span class="ico">${iconSvg('pin', GREEN, 18)}</span><div class="txt"><b>Location</b><br/>${esc(data.gps.address || '—')}</div>${mapPreviewSvg()}</div>`
    : `<div class="empty" style="height:110px;border-radius:6px">GPS location was not captured for this registration.</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=${PAGE_WIDTH}"/><title>MOOZZLE Certificate ${esc(data.moozzleId)}</title><style>${STYLES}</style></head>
<body><div id="page">
  <div class="header">
    ${logoBlock(data.logo, 300)}
    <div class="tag">One Muzzle.<br/>One Identity.<br/>One Digital Record.</div>
    <div class="right"><div style="display:flex;align-items:flex-start;gap:6px">Bringing<br/>Precision to<br/>Livestock ${iconSvg('leaf', '#4caf50', 16)}</div></div>
  </div>

  <div class="banner">
    <div><div class="id-label">MOOZZLE ID</div><div class="id">${esc(data.formattedId)}</div></div>
    <div class="divider"></div>
    <div class="slogan">Unique Identity for a Healthier,<br/>More Productive Future</div>
    <div class="herd">${bannerHerdSvg()}</div>
  </div>

  <div class="grid" style="height:340px">
    <div class="card" style="width:318px">${heading('cow', 'Animal Details', 22)}${animalRows}</div>
    <div style="flex:1;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;gap:10px;height:196px">
        ${image(data.animalPhoto, 'photo', 'Animal photo unavailable', 'flex:1;')}
        <div class="qr">${data.qrSvg}<div class="scan">Scan to Verify<br/>MOOZZLE ID</div><div class="qid">${esc(data.formattedId)}</div>${iconSvg('shield', GREEN, 22)}<div class="verified">Verified Identity<br/>Secure Record</div></div>
      </div>
      <div class="card" style="flex:1">${heading('user', 'Owner / Farmer Details')}${ownerRows}</div>
    </div>
  </div>

  <div class="grid" style="height:172px">
    <div class="card" style="flex:1">${heading('calendar', 'Registration Details')}${rows([['Date', data.registration.date], ['Time', data.registration.time], ['Registered By', data.registration.registeredBy], ['Organisation', data.registration.organisation]], 78)}</div>
    <div class="card" style="flex:1.12">${heading('pin', 'GPS Location')}${gps}</div>
    <div class="card" style="flex:1">${heading('flask', 'Production &amp; Health')}${rows([['Milking Status', data.health.milking, true], ['Pregnancy Status', data.health.pregnancy], ['Last Vaccination', data.health.lastVaccination], ['Next Due', data.health.nextDue], ['Health Status', data.health.status, true]], 92)}</div>
  </div>

  <div class="grid" style="height:150px">
    <div class="card" style="flex:2.25">${heading('fingerprint', 'Muzzle Biometric Images')}
      <div class="frames">${data.muzzle
        .map((frame) => `<div class="frame">${frame.src ? `<div class="shot${frame.enhance ? ' enhance' : ''}" style="background-image:url('${frame.src}')"></div>` : '<div class="shot empty">Not available</div>'}${esc(frame.label)}</div>`)
        .join('')}</div>
    </div>
    <div class="card" style="flex:1">${heading('document', 'Additional Information')}${rows([['Application Version', data.additional.version], ['Device ID', data.additional.deviceId], ['Network', data.additional.network], ['Registration Source', data.additional.source]], 104)}</div>
  </div>

  <div class="card cert">
    ${iconSvg('shield', GREEN, 34)}
    <div style="flex:1">
      <div class="title">MOOZZLE ID CERTIFICATE</div>
      <div class="body">This certifies that the above-mentioned animal has been uniquely identified using MOOZZLE's bovine biometric identification system and is linked to the digital livestock record. This record is valid and verifiable through the MOOZZLE platform.</div>
      <div class="meta">Record status: ${esc(data.recordStatus)} · Copy generated ${esc(data.generatedAt)}</div>
    </div>
    <div class="sign">${signatureSvg()}<div class="line"></div>Authorised Signatory<br/>MOOZZLE</div>
  </div>

  <div class="footer">
    <div class="art">${pastureSvg()}</div>
    <div class="bar">
      <div class="pillars"><span>${iconSvg('fingerprint', GREEN_DARK, 15)}Identify</span><i></i><span>${iconSvg('trace', GREEN_DARK, 15)}Trace</span><i></i><span>${iconSvg('manage', GREEN_DARK, 15)}Manage</span><i></i><span>${iconSvg('sustain', GREEN_DARK, 15)}Sustain</span></div>
      <div style="position:absolute;left:50%;bottom:0;margin-left:-105px">${logoBlock(data.logo, 210)}</div>
      <div class="brand"><b>MOOZZLE</b><br/>Digital Livestock Management<br/>for a Smarter Tomorrow</div>
    </div>
  </div>
</div></body></html>`;
}
