import { useState, useRef, useEffect } from 'react';

/**
 * Manages transient toast notification state.
 * Isolated so that showing/hiding toasts does not cause re-renders
 * in the game library, audio sources, or modal sub-trees.
 */
export function useToastState() {
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  // Clear any pending timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(msg) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }

  return { toast, showToast };
}
