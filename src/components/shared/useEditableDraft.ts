'use client';

import React from 'react';

type UseEditableDraftOptions<T> = {
  source: T;
  clone: (value: T) => T;
  normalize?: (value: T) => T;
  onBeforeEdit?: () => void;
  onExitEdit?: () => void;
  resetKey?: React.Key;
};

export function useEditableDraft<T>({
  source,
  clone,
  normalize,
  onBeforeEdit,
  onExitEdit,
  resetKey
}: UseEditableDraftOptions<T>) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<T | null>(null);
  const resetKeyRef = React.useRef(resetKey);
  const normalizeValue = React.useCallback((value: T) => normalize ? normalize(value) : value, [normalize]);
  const resetDraft = React.useCallback(() => {
    setDraft(null);
    setIsEditing(false);
    onExitEdit?.();
  }, [onExitEdit]);

  React.useEffect(() => {
    if (resetKeyRef.current === resetKey) return;
    resetKeyRef.current = resetKey;
    if (isEditing) resetDraft();
  }, [isEditing, resetDraft, resetKey]);

  const value = React.useMemo(
    () => normalizeValue(isEditing && draft !== null ? draft : source),
    [draft, isEditing, normalizeValue, source]
  );

  const startEdit = React.useCallback(() => {
    onBeforeEdit?.();
    setDraft(normalizeValue(clone(source)));
    setIsEditing(true);
  }, [clone, normalizeValue, onBeforeEdit, source]);

  const cancelEdit = React.useCallback(() => {
    resetDraft();
  }, [resetDraft]);

  const updateDraft = React.useCallback((mutator: (draft: T) => void) => {
    setDraft(prev => {
      const next = normalizeValue(clone(prev ?? source));
      mutator(next);
      return normalizeValue(next);
    });
  }, [clone, normalizeValue, source]);

  const replaceDraft = React.useCallback((nextDraft: T) => {
    setDraft(normalizeValue(clone(nextDraft)));
  }, [clone, normalizeValue]);

  const saveEdit = React.useCallback(async (
    saveDraft: (draft: T) => Promise<boolean>,
    prepareDraft?: (draft: T) => T
  ) => {
    if (draft === null) return false;
    const preparedDraft = prepareDraft ? prepareDraft(clone(draft)) : clone(draft);
    const saved = await saveDraft(normalizeValue(preparedDraft));
    if (!saved) return false;
    resetDraft();
    return true;
  }, [clone, draft, normalizeValue, resetDraft]);

  return {
    isEditing,
    draft,
    value,
    startEdit,
    cancelEdit,
    saveEdit,
    updateDraft,
    replaceDraft
  };
}
