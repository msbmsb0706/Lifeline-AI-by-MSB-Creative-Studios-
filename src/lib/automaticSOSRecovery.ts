import { getPendingQueue, savePendingSOS, transmitSingleSOSItem } from './emergencyPartnerQueue.ts';
import { EMERGENCY_PARTNER_PROVIDERS } from './emergencyPartnersData.ts';

// No transport inspection: Wi-Fi, cellular and satellite are identical here.
// A browser online signal is only an opportunity to probe the actual backend.
async function checkedGet(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export async function recoverAutomaticSOS(canProceed: () => boolean = () => true): Promise<void> {
  if (!navigator.onLine || !canProceed()) return;
  const eligible = getPendingQueue().filter(i => i.automaticRecovery === true &&
    i.sosPackage.demoOnly !== true && !i.recoveryBlocked &&
    (i.status === 'WAITING_FOR_CONNECTION' || i.status === 'PENDING_LOCAL') &&
    (!i.nextRecoveryAt || i.nextRecoveryAt <= Date.now()) &&
    (i.targetPartner.providerType === 'LOCAL_ONLY' || i.targetPartner.providerType === 'AUTHORIZED_API'));
  if (!eligible.length) return;
  const status = await checkedGet('/api/status');
  if (!canProceed() || !navigator.onLine ||
      typeof status?.server_time !== 'string' || typeof status?.status !== 'string') return;

  for (const candidate of eligible) {
    // Re-read after each await: user might have deleted/sent/changed this record.
    const current = getPendingQueue().find(i => i.sosPackage.sosId === candidate.sosPackage.sosId);
    if (!current || current.automaticRecovery !== true || current.recoveryBlocked ||
      !['WAITING_FOR_CONNECTION', 'PENDING_LOCAL'].includes(current.status) ||
      !navigator.onLine || !canProceed() || current.sosPackage.demoOnly === true) continue;
    const config = await checkedGet('/api/emergency-partner/config?country=GLOBAL');
    const configured = config?.success === true && config.data?.status === 'CONFIGURED' &&
      config.data?.automaticRecoverySupported === true;
    if (!configured) {
      if (config?.success === true &&
          (config.data?.status === 'NOT_CONFIGURED' || config.data?.automaticRecoverySupported !== true)) {
        if (current.errorMessage !== 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION') {
          current.errorMessage = 'CONNECTION AVAILABLE — NO AUTHORIZED DESTINATION';
          savePendingSOS(current);
        }
      }
      continue;
    }
    const latest = getPendingQueue().find(i => i.sosPackage.sosId === candidate.sosPackage.sosId);
    if (!latest || latest.automaticRecovery !== true || latest.recoveryBlocked ||
      !['WAITING_FOR_CONNECTION', 'PENDING_LOCAL'].includes(latest.status) || !navigator.onLine || !canProceed()) continue;
    if (latest.targetPartner.providerType === 'LOCAL_ONLY') {
      const template = EMERGENCY_PARTNER_PROVIDERS.find(p => p.providerType === 'AUTHORIZED_API');
      if (!template) continue;
      // Opt-in at confirmation authorizes metadata-only automatic handoff; saved GPS
      // remains excluded without the separate one-time GPS approval.
      latest.targetPartner = { ...template, country: 'GLOBAL', countryName: 'Global authorized integration',
        providerName: typeof config.data.providerName === 'string' ? config.data.providerName : 'Authorized partner API',
        apiEnabled: true, apiBaseUrl: '/api/emergency-partner/dispatch' };
      latest.userApprovedForPartnerTransmission = true;
      latest.gpsApprovedForPartnerTransmission = false;
    } else if (latest.targetPartner.providerType !== 'AUTHORIZED_API') continue;
    latest.errorMessage = 'CONNECTION RESTORED — Preparing to send your confirmed SOS...';
    if (!savePendingSOS(latest)) continue;
    if (!canProceed() || !navigator.onLine) continue;
    await transmitSingleSOSItem(latest);
  }
}

/** One foreground-only scheduler. No service worker/background delivery promise. */
export function startAutomaticSOSRecovery(isPaused: () => boolean): () => void {
  let disposed = false;
  let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    if (disposed || isPaused() || document.hidden || !navigator.onLine) return;
    const waiting = getPendingQueue().filter(i => i.automaticRecovery === true && !i.recoveryBlocked &&
      (i.status === 'WAITING_FOR_CONNECTION' || i.status === 'PENDING_LOCAL'));
    if (!waiting.length) return;
    const due = Math.min(...waiting.map(i => i.nextRecoveryAt || Date.now() + 300000));
    timer = setTimeout(run, Math.max(1000, Math.min(300000, due - Date.now())));
  };
  const run = async () => {
    if (disposed || busy || isPaused() || document.hidden || !navigator.onLine) return;
    busy = true;
    try { await recoverAutomaticSOS(() => !disposed && !isPaused() && !document.hidden); } finally { busy = false; schedule(); }
  };
  const visible = () => { if (!document.hidden) void run(); };
  const online = () => { void run(); };
  const focus = () => { void run(); };
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', online);
  window.addEventListener('focus', focus);
  window.addEventListener('lifeline-sos-saved', online);
  void run();
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('online', online);
    window.removeEventListener('focus', focus);
    window.removeEventListener('lifeline-sos-saved', online);
  };
}
