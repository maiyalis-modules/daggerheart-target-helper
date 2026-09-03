/**
 * Minimal ambient declarations for the slice of Sequencer this module touches.
 *
 * Sequencer is an optional install — nothing here is imported, only read off
 * `globalThis` behind a guard — so this describes the shape we probe for rather
 * than a dependency we take.
 */

export {};

declare global {
  /** One resolved database entry. `getAllFiles` yields the concrete file paths. */
  interface DhSequencerFile {
    getAllFiles?: () => unknown[];
  }

  /**
   * `Sequencer.Database`. `getEntry` returns a single entry, or an array when the
   * key matches several siblings (colour and variant families).
   * See modules/sequencer/dist/sequencer.js:6732.
   */
  interface DhSequencerDatabase {
    /** Fuzzy key search; returns matching dotted keys. See sequencer.js:6844. */
    searchFor?: (query: string) => unknown;
    getEntry?: (
      key: string,
      options?: { softFail?: boolean },
    ) => DhSequencerFile | DhSequencerFile[] | false;
  }
}
