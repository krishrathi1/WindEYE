import { useEffect, useRef } from "react";

// =============================================================================
// Global hotkeys
//
// Shortcuts are registered through the Tauri global-shortcut plugin and arrive
// back as a `global-hotkey` event carrying the shortcut string, which is mapped
// to an action here.
// =============================================================================

export type HotkeyAction =
  | "toggle_expand"
  | "media_play_pause"
  | "media_next"
  | "media_previous"
  | "start_timer"
  | "open_clipboard";

export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  toggle_expand: "CommandOrControl+Shift+Space",
  media_play_pause: "CommandOrControl+Shift+P",
  media_next: "CommandOrControl+Shift+Right",
  media_previous: "CommandOrControl+Shift+Left",
  start_timer: "CommandOrControl+Shift+T",
  open_clipboard: "CommandOrControl+Shift+V",
};

type Handlers = Partial<Record<HotkeyAction, () => void>>;

export function useGlobalHotkeys(
  enabled: boolean,
  handlers: Handlers,
  bindings: Record<HotkeyAction, string> = DEFAULT_HOTKEYS
) {
  // Keep the latest handlers in a ref so re-registering isn't needed when a
  // callback identity changes between renders.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    const registered: string[] = [];

    const setup = async () => {
      try {
        const [{ listen }, shortcutApi] = await Promise.all([
          import("@tauri-apps/api/event"),
          import("@tauri-apps/plugin-global-shortcut"),
        ]);
        if (disposed) return;

        // Map shortcut string -> action, and de-duplicate presses: the JS callback
        // and the Rust-side `global-hotkey` event can both fire for one press
        // depending on plugin version, so the action runs at most once per 250ms.
        const lookup = new Map<string, HotkeyAction>();
        const lastFired = new Map<HotkeyAction, number>();
        const fire = (action: HotkeyAction) => {
          const now = Date.now();
          if (now - (lastFired.get(action) ?? 0) < 250) return;
          lastFired.set(action, now);
          handlersRef.current[action]?.();
        };

        for (const [action, accelerator] of Object.entries(bindingsRef.current)) {
          if (!accelerator) continue;
          const typedAction = action as HotkeyAction;
          lookup.set(accelerator.toLowerCase(), typedAction);
          try {
            const already = await shortcutApi.isRegistered(accelerator);
            if (!already) {
              await shortcutApi.register(accelerator, () => fire(typedAction));
            }
            registered.push(accelerator);
          } catch {
            // A shortcut already owned by another app simply won't bind.
          }
        }

        unlisten = await listen<string>("global-hotkey", (event) => {
          const action = lookup.get(String(event.payload).toLowerCase());
          if (!action) return;
          fire(action);
        });
      } catch {
        // Plugin unavailable (e.g. non-desktop build) — hotkeys stay inert.
      }
    };

    setup();

    return () => {
      disposed = true;
      unlisten?.();
      import("@tauri-apps/plugin-global-shortcut")
        .then((api) => {
          for (const accelerator of registered) {
            api.unregister(accelerator).catch(() => {});
          }
        })
        .catch(() => {});
    };
  }, [enabled]);
}
