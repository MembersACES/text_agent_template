/**
 * Branch/agent logo resolution.
 *
 * - Per-agent logos live in `public/branch-logos/` (e.g. `htg.jpg`).
 * - If no agent-specific logo is configured, we fall back to the main ACES logo.
 */

// Map of agentId -> logo filename inside /public/branch-logos
const LOGO_BY_AGENT_ID: Record<string, string> = {
  // Honest to Goodness agent: Hazel, the hazelnut character H2G named the agent
  // after. Cropped to the nut itself because the avatar renders in a 32px circle,
  // where the full character's arms and legs are cut off and unreadable.
  'honest-to-goodness-agent': 'hazel.png',
};

// When an agent doesn't have a dedicated logo, we show the ACES product logo
const DEFAULT_LOGO_PATH = '/Logo3.png';

export function getBranchLogoUrl(agentId?: string | null): string {
  const filename = agentId ? LOGO_BY_AGENT_ID[agentId] : undefined;
  if (filename) {
    return `/branch-logos/${filename}`;
  }
  return DEFAULT_LOGO_PATH;
}
