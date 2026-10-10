import type { Role } from './rbac';

/**
 * Synthetic demo accounts for testing each stakeholder role. Shortcuts are only shown when the
 * build is a demo build (EXPO_PUBLIC_DEMO_MODE is not "false"). These accounts hold synthetic data
 * only; the shared password is a demo credential, not a production secret.
 */
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE !== 'false';
export const DEMO_PASSWORD = 'MoozzleDemo@2026';

export interface DemoAccount {
  email: string;
  role: Role;
  name: string;
  note: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'demo.admin@moozzle.com', role: 'Super Administrator', name: 'Aarav Mehta', note: 'MOOZZLE Platform' },
  { email: 'demo.orgadmin@moozzle.com', role: 'Organisation Administrator', name: 'Kavita Desai', note: 'Sabar Dairy Cooperative' },
  { email: 'demo.government@moozzle.com', role: 'Government Officer', name: 'Dr. Suresh Rathod', note: 'Sabarkantha district' },
  { email: 'demo.vet@moozzle.com', role: 'Veterinarian', name: 'Dr. Priya Sharma', note: '2 Sabar Dairy farms' },
  { email: 'demo.ai@moozzle.com', role: 'AI Technician', name: 'Rajesh Solanki', note: '2 Sabar Dairy farms' },
  { email: 'demo.farmer@moozzle.com', role: 'Farmer', name: 'Ramesh Patel', note: '3 own animals' },
  { email: 'demo.farmmanager@moozzle.com', role: 'Farm Manager', name: 'Bhavesh Chaudhary', note: 'Patel Dairy Farm' },
  { email: 'demo.insurance@moozzle.com', role: 'Insurance Officer', name: 'Neha Iyer', note: 'Bharat Livestock Insurance' },
  { email: 'demo.inspector@moozzle.com', role: 'Livestock Inspector', name: 'Imran Shaikh', note: 'Sabarkantha + Mehsana' },
  { email: 'demo.fieldworker@moozzle.com', role: 'Field Worker', name: 'Sunita Vaghela', note: 'Shree Krishna Gaushala' },
  { email: 'demo.researcher@moozzle.com', role: 'Researcher', name: 'Dr. Ananya Rao', note: 'De-identified data only' },
  { email: 'demo.apiadmin@moozzle.com', role: 'API Administrator', name: 'Vikram Nair', note: 'Integrations' },
  { email: 'demo.multirole@moozzle.com', role: 'Veterinarian', name: 'Dr. Harsh Joshi', note: 'Vet + AI Tech + Farm Manager' },
];
