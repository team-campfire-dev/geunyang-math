'use client';
import { useEffect } from 'react';

export function useUnsavedForm(dirty: boolean, onDirty?: (dirty: boolean) => void) {
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = true; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}
export function discardChanges(dirty: boolean) {
  return !dirty || window.confirm('저장하지 않은 입력이 있어요. 변경을 버리고 이동할까요?');
}
