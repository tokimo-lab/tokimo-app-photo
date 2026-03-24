import { useQueryClient } from "@tanstack/react-query";
import { Dropdown, type DropdownMenuItem, Modal } from "@tokiomo/components";
import { Link, Pencil, Plus, Users } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PersonOutput, PhotoFaceOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";

const THUMB_WIDTH = 800;

interface PhotoFacesPanelProps {
  photoId: string;
  appId: string;
  photoWidth: number | null;
  photoHeight: number | null;
  hoveredFaceId: number | null;
  onHoverFace: (faceId: number | null) => void;
  onNavigateToPerson?: (personId: string) => void;
}

export function PhotoFacesPanel({
  photoId,
  appId,
  photoWidth,
  photoHeight,
  hoveredFaceId,
  onHoverFace,
  onNavigateToPerson,
}: PhotoFacesPanelProps) {
  const { data: faces } = api.photoSettings.getPhotoFaces.useQuery(
    { photoId },
    { enabled: !!photoId },
  );

  if (!faces || faces.length === 0) return null;

  return (
    <div className="border-t border-white/10 pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/40">
        <Users className="h-3 w-3" />
        人物
      </div>
      <div className="flex flex-wrap gap-3">
        {faces.map((face) => (
          <FaceChip
            key={face.id}
            face={face}
            photoId={photoId}
            appId={appId}
            photoWidth={photoWidth}
            photoHeight={photoHeight}
            isHovered={hoveredFaceId === face.id}
            onHover={onHoverFace}
            onNavigateToPerson={onNavigateToPerson}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Compute background-image CSS to crop a face from the photo thumbnail.
 * Face coordinates are in original-image pixels; the thumbnail is THUMB_WIDTH wide.
 */
function computeFaceBgStyle(
  face: PhotoFaceOutput,
  photoWidth: number,
  photoHeight: number,
  chipSize: number,
  thumbnailSrc: string,
): CSSProperties {
  const s = THUMB_WIDTH / photoWidth;
  const thumbHeight = photoHeight * s;
  const fx = face.x * s;
  const fy = face.y * s;
  const fw = face.w * s;
  const fh = face.h * s;

  const pad = Math.max(fw, fh) * 0.35;
  const cropSize = Math.max(fw, fh) + pad * 2;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const half = cropSize / 2;
  const cropLeft = Math.max(0, Math.min(cx - half, THUMB_WIDTH - cropSize));
  const cropTop = Math.max(0, Math.min(cy - half, thumbHeight - cropSize));

  const zoom = chipSize / cropSize;

  return {
    backgroundImage: `url(${thumbnailSrc})`,
    backgroundSize: `${THUMB_WIDTH * zoom}px ${thumbHeight * zoom}px`,
    backgroundPosition: `${-cropLeft * zoom}px ${-cropTop * zoom}px`,
    backgroundRepeat: "no-repeat",
  };
}

// ── PersonPickerModal ────────────────────────────────────────────────────────

function PersonPickerModal({
  appId,
  onSelect,
  onClose,
}: {
  appId: string;
  onSelect: (person: PersonOutput) => void;
  onClose: () => void;
}) {
  const { data: persons } = api.photoSettings.listPersons.useQuery(
    { appId },
    { enabled: !!appId },
  );

  return (
    <Modal open onCancel={onClose} title="关联人物" size="form" footer={null}>
      <div className="max-h-64 overflow-y-auto">
        {persons && persons.length > 0 ? (
          <div className="flex flex-col gap-1">
            {persons.map((person) => (
              <button
                key={person.id}
                type="button"
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-700"
                onClick={() => onSelect(person)}
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-600">
                  {person.avatarPhotoId ? (
                    <img
                      src={`/api/photos/${person.avatarPhotoId}/thumbnail`}
                      alt={person.name ?? "未命名"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Users className="h-4 w-4 text-neutral-400" />
                    </div>
                  )}
                </div>
                <span className="truncate">{person.name ?? "未命名"}</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {person.faceCount} 张
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-neutral-500">暂无人物</p>
        )}
      </div>
    </Modal>
  );
}

// ── FaceChip ─────────────────────────────────────────────────────────────────

function FaceChip({
  face,
  photoId,
  appId,
  photoWidth,
  photoHeight,
  isHovered,
  onHover,
  onNavigateToPerson,
}: {
  face: PhotoFaceOutput;
  photoId: string;
  appId: string;
  photoWidth: number | null;
  photoHeight: number | null;
  isHovered: boolean;
  onHover: (faceId: number | null) => void;
  onNavigateToPerson?: (personId: string) => void;
}) {
  const chipSize = 56;
  const thumbnailSrc = `/api/photos/${photoId}/thumbnail?w=${THUMB_WIDTH}`;
  const canCrop = photoWidth != null && photoHeight != null && photoWidth > 0;
  const queryClient = useQueryClient();

  const bgStyle = canCrop
    ? computeFaceBgStyle(face, photoWidth, photoHeight, chipSize, thumbnailSrc)
    : undefined;

  // ── Mutations ──
  const assignMutation = api.photoSettings.assignFaceToPerson.useMutation({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/photos/{id}/faces"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/apps/{id}/persons"],
      });
    },
  });

  const createPersonMutation =
    api.photoSettings.createPersonFromFace.useMutation({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["/api/photos/{id}/faces"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["/api/apps/{id}/persons"],
        });
      },
    });

  const renameMutation = api.photoSettings.renamePerson.useMutation({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["/api/photos/{id}/faces"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["/api/apps/{id}/persons"],
      });
    },
  });

  // ── Local state ──
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  const handleAvatarClick = useCallback(() => {
    if (face.personId && onNavigateToPerson) {
      onNavigateToPerson(face.personId);
    }
  }, [face.personId, onNavigateToPerson]);

  const handleAssignPerson = useCallback(
    (person: PersonOutput) => {
      setShowPersonPicker(false);
      assignMutation.mutate({ photoId, faceId: face.id, personId: person.id });
    },
    [photoId, face.id, assignMutation],
  );

  const handleCreatePerson = useCallback(() => {
    createPersonMutation.mutate({ photoId, faceId: face.id });
  }, [photoId, face.id, createPersonMutation]);

  const handleStartRename = useCallback(() => {
    setRenameValue(face.personName ?? "");
    setRenaming(true);
  }, [face.personName]);

  const handleSubmitRename = useCallback(() => {
    if (!face.personId || !renameValue.trim()) return;
    renameMutation.mutate({
      appId,
      personId: face.personId,
      name: renameValue.trim(),
    });
    setRenaming(false);
  }, [appId, face.personId, renameValue, renameMutation]);

  const dropdownMenuItems: DropdownMenuItem[] = useMemo(() => {
    const items: DropdownMenuItem[] = [
      {
        key: "link",
        label: "关联人物",
        icon: <Link className="h-3.5 w-3.5" />,
        onClick: () => setShowPersonPicker(true),
      },
      {
        key: "create",
        label: "创建新人物",
        icon: <Plus className="h-3.5 w-3.5" />,
        onClick: handleCreatePerson,
      },
    ];
    if (face.personId) {
      items.push({
        key: "rename",
        label: "修改名称",
        icon: <Pencil className="h-3.5 w-3.5" />,
        onClick: handleStartRename,
      });
    }
    return items;
  }, [face.personId, handleCreatePerson, handleStartRename]);

  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: wrapper div for hover tracking */}
      <div
        className="flex w-16 flex-col items-center gap-1"
        role="group"
        onMouseEnter={() => onHover(face.id)}
        onMouseLeave={() => onHover(null)}
      >
        {/* Avatar: click navigates to person */}
        <button
          type="button"
          className={`h-14 w-14 overflow-hidden rounded-full border-2 transition-all ${
            face.personId ? "cursor-pointer" : "cursor-default"
          } ${
            isHovered
              ? "border-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]"
              : "border-white/20 hover:border-white/40"
          }`}
          onClick={handleAvatarClick}
          title={face.personId ? "查看人物照片" : undefined}
        >
          {bgStyle ? (
            <div
              className="h-full w-full"
              style={bgStyle}
              role="img"
              aria-label={face.personName ?? "未命名"}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/10 text-white/30">
              <Users className="h-6 w-6" />
            </div>
          )}
        </button>

        {/* Name: click opens dropdown menu */}
        {renaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={handleSubmitRename}
            className="w-full rounded border border-blue-400/50 bg-white/10 px-1 text-center text-[11px] leading-tight text-white outline-none"
          />
        ) : (
          <Dropdown
            menu={{ items: dropdownMenuItems }}
            trigger={["click"]}
            placement="bottom"
          >
            <button
              type="button"
              className={`max-w-full cursor-pointer truncate text-center text-[11px] leading-tight transition-colors hover:text-blue-300 ${
                isHovered ? "text-blue-400" : "text-white/60"
              }`}
              title={face.personName ?? undefined}
            >
              {face.personName || "未命名"}
            </button>
          </Dropdown>
        )}
      </div>

      {showPersonPicker && (
        <PersonPickerModal
          appId={appId}
          onSelect={handleAssignPerson}
          onClose={() => setShowPersonPicker(false)}
        />
      )}
    </>
  );
}
