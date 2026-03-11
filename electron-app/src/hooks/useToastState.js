import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Manages transient toast notification state and timing in a single place.
 * Encapsulates toast logic so it can be managed independently of the
 * game library, audio sources, or modal sub-trees.
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

  const showToast = useCallback((msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []); // toastTimerRef is a stable ref; setToast is a stable setter

  return { toast, showToast };
}
