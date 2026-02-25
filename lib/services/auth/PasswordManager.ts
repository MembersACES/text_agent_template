import { getLogger } from '@/lib/config/logger';
import { settings } from '@/lib/config/settings';

const logger = getLogger('PasswordManager');

export class PasswordManager {
  private readonly sitePassword: string;

  constructor() {
    this.sitePassword = settings.auth.sitePassword;
  }

  verify(password: string): boolean {
    const match = password === this.sitePassword;
    if (!match) {
      logger.warn('Failed authentication attempt');
    }
    return match;
  }
}
