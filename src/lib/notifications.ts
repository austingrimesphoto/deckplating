export type NotificationMode = 'disabled' | 'mailto' | 'provider';

export type NotificationConfig = {
  mode?: string;
  from?: string;
  replyTo?: string;
  appBaseUrl: string;
  setupSiteBaseUrl: string;
  providerApiKey?: string;
};

export type WorkspaceApprovedNotificationInput = {
  workspaceDisplayName: string;
  workspaceSlug: string;
  recipientEmail: string;
  setupCode?: string;
  includeSetupCode: boolean;
};

export type NotificationResult = {
  status: string;
  recipientEmail: string;
  workspaceSlug: string;
  timestamp: string;
  subject: string;
  text: string;
  mailtoUrl?: string;
};

export const notificationModes = new Set<NotificationMode>(['disabled', 'mailto', 'provider']);

export function normalizeNotificationMode(value: string | undefined): NotificationMode {
  const mode = String(value ?? 'disabled').toLowerCase();
  return notificationModes.has(mode as NotificationMode) ? (mode as NotificationMode) : 'disabled';
}

export function workspaceApprovedMessage(input: WorkspaceApprovedNotificationInput, config: Pick<NotificationConfig, 'appBaseUrl' | 'setupSiteBaseUrl'>) {
  const workspaceLink = `${config.appBaseUrl.replace(/\/+$/, '')}/?workspace=${encodeURIComponent(input.workspaceSlug)}`;
  const setupGuide = `${config.setupSiteBaseUrl.replace(/\/+$/, '')}/`;
  const userGuide = `${config.setupSiteBaseUrl.replace(/\/+$/, '')}/user-guide.html`;
  const subject = 'Deckplating demonstration workspace approved';
  const setupCodeLine =
    input.includeSetupCode && input.setupCode
      ? [`One-time setup code: ${input.setupCode}`, 'Do not forward setup codes or enter them in feedback forms, screenshots, or public docs.', '']
      : ['Setup code: contact the operator or local lead through an authorized channel.', ''];
  const text = [
    `Your Deckplating demonstration workspace is approved: ${input.workspaceDisplayName}`,
    '',
    `Workspace link: ${workspaceLink}`,
    ...setupCodeLine,
    `Setup guide: ${setupGuide}`,
    `User guide: ${userGuide}`,
    '',
    'Deckplating is an unofficial open-source prototype pending local authorization. It is not approved by the Department of the Navy or Department of Defense.',
    'Use it only for unclassified, non-sensitive coverage awareness unless local IT/N6, privacy, records, OPSEC, and command guidance authorize use.',
    'Do not enter CUI, classified information, counseling notes, case management, medical information, incident details, family information, home addresses, phone numbers, dates of birth, passphrases, setup codes, sensitive locations, or official records.',
  ].join('\n');
  return { subject, text, workspaceLink, setupGuide, userGuide };
}

export async function sendWorkspaceApprovedNotification(
  input: WorkspaceApprovedNotificationInput,
  config: NotificationConfig,
  sender?: (message: { to: string; subject: string; text: string; from?: string; replyTo?: string }) => Promise<string>,
): Promise<NotificationResult> {
  const mode = normalizeNotificationMode(config.mode);
  const message = workspaceApprovedMessage(input, config);
  const timestamp = new Date().toISOString();
  const base = {
    recipientEmail: input.recipientEmail,
    workspaceSlug: input.workspaceSlug,
    timestamp,
    subject: message.subject,
    text: message.text,
  };

  if (mode === 'disabled') {
    return { ...base, status: 'skipped: notifications disabled' };
  }
  if (mode === 'mailto') {
    const params = new URLSearchParams({ subject: message.subject, body: message.text });
    return { ...base, status: 'mailto: ready for operator', mailtoUrl: `mailto:${encodeURIComponent(input.recipientEmail)}?${params.toString()}` };
  }
  if (!config.providerApiKey || !config.from) return { ...base, status: 'failed: provider notification environment not configured' };
  return { ...base, status: sender ? await sender({ to: input.recipientEmail, subject: message.subject, text: message.text, from: config.from, replyTo: config.replyTo }) : 'failed: provider sender not implemented' };
}
