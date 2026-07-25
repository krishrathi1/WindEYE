import { useState, useEffect, useRef, useCallback } from "react";
import { platformApi } from "../lib/platform";

// =============================================================================
// Connected Bluetooth devices and their battery level
//
// Only BLE devices that expose the standard GATT Battery Service report a level.
// Classic-Bluetooth headsets connect without one, so they appear in the list with
// `batteryPercent: null` rather than being hidden.
// =============================================================================

export interface BluetoothDevice {
  id: string;
  name: string;
  isConnected: boolean;
  batteryPercent: number | null;
}

export function useBluetoothDevices(enabled: boolean, pollInterval = 30000): BluetoothDevice[] {
  const [devices, setDevices] = useState<BluetoothDevice[]>([]);
  const isMountedRef = useRef(true);
  const isPendingRef = useRef(false);

  const fetchDevices = useCallback(async () => {
    if (!isMountedRef.current || isPendingRef.current) return;
    isPendingRef.current = true;
    try {
      const result = await platformApi.getBluetoothDevices();
      if (Array.isArray(result) && isMountedRef.current) {
        setDevices(
          result.map((d) => ({
            id: d.id,
            name: d.name,
            isConnected: d.is_connected,
            batteryPercent: d.battery_percent ?? null,
          }))
        );
      }
    } catch {
      // Bluetooth may be off or unsupported; keep the list empty.
    } finally {
      isPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    if (!enabled) return () => { isMountedRef.current = false; };

    fetchDevices();
    // GATT reads wake the radio, so poll gently.
    const id = setInterval(fetchDevices, pollInterval);
    return () => {
      isMountedRef.current = false;
      clearInterval(id);
    };
  }, [enabled, fetchDevices, pollInterval]);

  return devices;
}
