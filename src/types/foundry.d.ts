/**
 * Minimal ambient declarations for the FoundryVTT globals this module touches.
 *
 * This is a deliberately small shim so the project type-checks and builds without
 * pulling in the full community type packages. When you want richer typings,
 * install `fvtt-types` (https://github.com/League-of-Foundry-Developers/foundry-vtt-types)
 * and delete this file.
 */

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObject = Record<string, any>;

  /** Loose stand-in for jQuery — some classic Foundry hooks still pass it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JQuery = any;

  /** The persisted side of a Token. */
  interface TokenDocument {
    id: string;
    /** GM-hidden tokens should never be offered as targets. */
    hidden: boolean;
    /** CONST.TOKEN_DISPOSITIONS: -1 hostile, 0 neutral, 1 friendly, 2 secret. */
    disposition: number;
  }

  /** A Token placeable on the canvas. */
  interface Token {
    id: string;
    name: string;
    document: TokenDocument;
    actor?:
      | ({
          id: string;
          uuid: string;
          img: string;
          /** Status effect ids currently applied — conditions live here. */
          statuses?: Set<string>;
        } & AnyObject)
      | null;
    /** Whether the token is currently drawn — deliberately NOT used for
     * filtering targets, since ToTM tokens are often off-screen. */
    visible?: boolean;
  }

  /** The active canvas. `tokens` is undefined until the canvas is ready. */
  const canvas: {
    scene?: { id: string } | null;
    tokens?: {
      placeables: Token[];
      get(id: string): Token | undefined;
      /**
       * Assign token targets and broadcast to other clients.
       * Synchronous — do not await. See client/canvas/layers/tokens.mjs:335.
       */
      setTargets(
        targetIds: string[] | Set<string>,
        options?: { mode?: "replace" | "acquire" | "release" },
      ): void;
    };
  } & AnyObject;

  /** Foundry's global hook dispatcher. */
  const Hooks: {
    on(hook: string, fn: (...args: any[]) => unknown): number;
    once(hook: string, fn: (...args: any[]) => unknown): number;
    off(hook: string, fn: number | ((...args: any[]) => unknown)): void;
    call(hook: string, ...args: any[]): boolean;
    callAll(hook: string, ...args: any[]): boolean;
  };

  /** The active game instance. Only ready after the `ready` hook fires. */
  const game: {
    modules: Map<string, { active: boolean; api?: unknown } & AnyObject>;
    system: { id: string; version: string } & AnyObject;
    settings: {
      register(namespace: string, key: string, data: AnyObject): void;
      registerMenu(namespace: string, key: string, data: AnyObject): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    user?: { id: string; isGM: boolean; name: string; targets: Set<Token> } & AnyObject;
    /** Present once the socket connects; requires `"socket": true` in module.json. */
    socket?: {
      on(event: string, callback: (...args: any[]) => void): void;
      emit(event: string, ...args: any[]): void;
    };
    i18n: {
      localize(key: string): string;
      format(key: string, data?: AnyObject): string;
    };
  } & AnyObject;

  /** Synchronous UUID resolution. Returns null for anything not yet loaded. */
  function fromUuidSync(uuid: string): AnyObject | null;

  const CONFIG: AnyObject;
  const ui: AnyObject & {
    notifications?: { info(m: string): void; warn(m: string): void; error(m: string): void };
  };

  /** The Foundry client-side API namespace (ApplicationV2, template helpers). */
  const foundry: {
    applications: {
      api: {
        ApplicationV2: any;
        HandlebarsApplicationMixin: <T>(base: T) => T;
        DialogV2: any;
      };
      handlebars: {
        loadTemplates(paths: string[]): Promise<unknown>;
      };
    };
    utils: AnyObject;
  } & AnyObject;
}
