import { useCallback, useRef, useState } from "react";
import type { PhotoOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { usePhotoI18n } from "../i18n";

interface UsePhotoMutationsParams {
  id: string | undefined;
  selectedIds: Set<string>;
  clearSelection: () => void;
  message: { success: (msg: string) => void; error: (msg: string) => void };
  refetchPhotos: () => void;
  refetchFavorites: () => void;
  refetchTrashed: () => void;
  refetchAlbums: () => void;
  resetTrash: () => void;
}

export function usePhotoMutations({
  id,
  selectedIds,
  clearSelection,
  message,
  refetchPhotos,
  refetchFavorites,
  refetchTrashed,
  refetchAlbums,
  resetTrash,
}: UsePhotoMutationsParams) {
  const { t } = usePhotoI18n();
  const [isRestoring, setIsRestoring] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingToAlbum, setIsAddingToAlbum] = useState(false);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);

  // Stable refs to avoid re-render cascades from useCallback deps
  const refetchPhotosRef = useRef(refetchPhotos);
  refetchPhotosRef.current = refetchPhotos;
  const refetchFavRef = useRef(refetchFavorites);
  refetchFavRef.current = refetchFavorites;
  const refetchTrashedRef = useRef(refetchTrashed);
  refetchTrashedRef.current = refetchTrashed;
  const messageRef = useRef(message);
  messageRef.current = message;
  const clearSelectionRef = useRef(clearSelection);
  clearSelectionRef.current = clearSelection;
  const tRef = useRef(t);
  tRef.current = t;

  // ── Favorite toggle ─────────────────────────────────────────────────────
  const toggleFavMutation = api.photo.togglePhotoFavorite.useMutation({
    onSuccess: () => {
      void refetchPhotosRef.current();
      void refetchFavRef.current();
    },
  });
  const toggleFavRef = useRef(toggleFavMutation.mutate);
  toggleFavRef.current = toggleFavMutation.mutate;

  const handleToggleFavorite = useCallback((photo: PhotoOutput) => {
    toggleFavRef.current({ photoId: photo.id });
  }, []);

  // ── Batch operations ──────────────────────────────────────────────────
  const batchFavMutation = api.photo.batchFavorite.useMutation({
    onSuccess: (data) => {
      messageRef.current.success(tRef.current("mutationUpdated", { count: data.updated }));
      clearSelectionRef.current();
      void refetchPhotosRef.current();
      void refetchFavRef.current();
    },
    onError: (e) => messageRef.current.error(e.message || tRef.current("mutationFailed")),
  });

  const addToAlbumMutation = api.photo.addPhotosToAlbum.useMutation({
    onMutate: () => setIsAddingToAlbum(true),
    onSettled: () => setIsAddingToAlbum(false),
    onSuccess: () => {
      messageRef.current.success(tRef.current("albumAddedSuccess"));
      clearSelectionRef.current();
      setShowAlbumPicker(false);
      void refetchAlbums();
    },
    onError: (e) => messageRef.current.error(e.message || tRef.current("mutationFailed")),
  });

  const handleBatchFavorite = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchFavMutation.mutate({
      id: id,
      photoIds: [...selectedIds],
      favorite: true,
    });
  }, [id, selectedIds, batchFavMutation.mutate]);

  const handleBatchUnfavorite = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchFavMutation.mutate({
      id: id,
      photoIds: [...selectedIds],
      favorite: false,
    });
  }, [id, selectedIds, batchFavMutation.mutate]);

  const handleAddToAlbum = useCallback(
    (albumId: string) => {
      addToAlbumMutation.mutate({
        albumId,
        photoIds: [...selectedIds],
      });
    },
    [selectedIds, addToAlbumMutation.mutate],
  );

  // ── Batch hide mutation ────────────────────────────────────────
  const batchHideMutation = api.photo.batchHide.useMutation();
  const batchHideMutateRef = useRef(batchHideMutation.mutate);
  batchHideMutateRef.current = batchHideMutation.mutate;

  const handleBatchHide = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    batchHideMutateRef.current(
      { id: id, photoIds: [...selectedIds], hidden: true },
      {
        onSuccess: () => {
          messageRef.current.success(tRef.current("mutationHidden", { count: selectedIds.size }));
          clearSelectionRef.current();
          refetchPhotosRef.current();
          refetchFavRef.current();
        },
      },
    );
  }, [id, selectedIds]);

  // ── Trash mutation ────────────────────────────────────────────
  const trashMutation = api.photo.trashPhotos.useMutation();
  const trashMutateRef = useRef(trashMutation.mutate);
  trashMutateRef.current = trashMutation.mutate;

  const handleTrash = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    if (!window.confirm(tRef.current("mutationTrashConfirm", { count: selectedIds.size })))
      return;
    trashMutateRef.current(
      { id: id, photoIds: [...selectedIds] },
      {
        onSuccess: () => {
          messageRef.current.success(
            tRef.current("mutationTrashed", { count: selectedIds.size }),
          );
          clearSelectionRef.current();
          refetchPhotosRef.current();
          refetchFavRef.current();
        },
      },
    );
  }, [id, selectedIds]);

  // ── Trash operations ──────────────────────────────────────────────────
  const restoreMutation = api.photo.restorePhotos.useMutation({
    onMutate: () => setIsRestoring(true),
    onSettled: () => setIsRestoring(false),
    onSuccess: (data) => {
      messageRef.current.success(tRef.current("mutationRestored", { count: data.restored }));
      clearSelectionRef.current();
      resetTrash();
      void refetchTrashedRef.current();
      void refetchPhotosRef.current();
    },
    onError: (e) => messageRef.current.error(e.message || tRef.current("mutationRestoreFailed")),
  });

  const permanentDeleteMutation = api.photo.permanentDelete.useMutation({
    onMutate: () => setIsDeleting(true),
    onSettled: () => setIsDeleting(false),
    onSuccess: (data) => {
      messageRef.current.success(tRef.current("mutationDeleted", { count: data.deleted }));
      clearSelectionRef.current();
      resetTrash();
      void refetchTrashedRef.current();
    },
    onError: (e) => messageRef.current.error(e.message || tRef.current("mutationDeleteFailed")),
  });

  const handleRestore = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    restoreMutation.mutate({ id: id, photoIds: [...selectedIds] });
  }, [id, selectedIds, restoreMutation.mutate]);

  const handlePermanentDelete = useCallback(() => {
    if (!id || selectedIds.size === 0) return;
    if (!window.confirm(tRef.current("mutationDeleteConfirm"))) return;
    permanentDeleteMutation.mutate({
      id: id,
      photoIds: [...selectedIds],
    });
  }, [id, selectedIds, permanentDeleteMutation.mutate]);

  return {
    handleToggleFavorite,
    handleBatchFavorite,
    handleBatchUnfavorite,
    handleAddToAlbum,
    handleBatchHide,
    handleTrash,
    handleRestore,
    handlePermanentDelete,
    isRestoring,
    isDeleting,
    isAddingToAlbum,
    showAlbumPicker,
    setShowAlbumPicker,
  };
}
