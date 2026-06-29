// Single source of truth for the LiberAudio "SetBrain demo" limits.
//
// LiberAudio ships a deliberately limited preview of the SetBrain DJ suite as
// a funnel. Every limit lives here so it is greppable, honest, and changeable
// in exactly one place. The library VIEWER (browse / search / cues / health)
// is intentionally unlimited — that is the hook. Only the organizational
// actions are capped.
//
// NOTE: this is OSS/MIT. Anyone can fork and raise these numbers — that is
// accepted (see the master plan §0). The real moat (Set Brain ordering, cue
// sync, cloud) only ever exists in the private SetBrain repo, never here.

export const DEMO_LIMITS = {
  /** Tracks a user may sort in one triage session before the upgrade panel. */
  triagePerSession: 5,
  /** Max destination groups a user may create. */
  maxGroups: 1,
  /** Max members per destination group. */
  maxMembersPerGroup: 2,
  /** Max tracks pushed to Spotify per sync. */
  syncTracksPerPush: 5,
  /** Whether "create a new Spotify playlist from sync" is allowed. */
  allowCreatePlaylist: false,
} as const;

/**
 * Marketing site for "Learn more" links in upgrade hints.
 * TODO: set once the domain is purchased (setbrain.net / .org / .uk — .com is
 * parked at $6k). Empty string = the hint hides its "Learn more" action.
 */
export const SETBRAIN_URL = '';

export type DemoLimits = typeof DEMO_LIMITS;
