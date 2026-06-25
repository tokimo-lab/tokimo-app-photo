import { Button, Empty, Spin } from "@tokimo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Pencil, User, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../generated/rust-api";
import { api } from "../generated/rust-api";
import type { PersonOutput } from "../generated/rust-types/index";
import { thumbUrl } from "../lib/thumb";
import { PhotoTimeline } from "./PhotoTimeline";
import { PAGE_SIZE } from "./photo-utils";

interface PhotoPeopleViewProps {
  appId: string | undefined;
  onToggleFavorite: (photo: PhotoOutput) => void;
  isSelecting: boolean;
  selectedIds: Set<string>;
  onSelect: (photo: PhotoOutput) => void;
  targetRowHeight: number;
  navigateToPersonId?: string | null;
  onNavigateToPersonHandled?: () => void;
}

type ViewLevel = "grid" | "detail";

interface ViewState {
  level: ViewLevel;
  person?: PersonOutput;
}

export function PhotoPeopleView({
  appId,
  onToggleFavorite,
  isSelecting,
  selectedIds,
  onSelect,
  targetRowHeight,
  navigateToPersonId,
  onNavigateToPersonHandled,
}: PhotoPeopleViewProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewState>({ level: "grid" });
  const [photosPage, setPhotosPage] = useState(1);
  const photosAccumRef = useRef<PhotoOutput[]>([]);

  // Rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const personsQuery = api.photo.listPersons.useQuery(
    { id: appId! },
    { enabled: !!appId },
  );

  const photosQuery = api.photo.personPhotos.useQuery(
    {
      id: appId!,
      personId: view.person?.id ?? "",
      page: photosPage,
      pageSize: PAGE_SIZE,
    },
    { enabled: !!appId && view.level === "detail" && !!view.person },
  );

  const renameMutation = api.photo.renamePerson.useMutation({
    onSuccess: () => {
      void personsQuery.refetch();
      api.photo.getPhotoFaces.invalidate(queryClient);
      // Update local view state name
      if (view.person && editingId === view.person.id) {
        setView((prev) => ({
          ...prev,
          person: prev.person
            ? { ...prev.person, name: editName || null }
            : undefined,
        }));
      }
      setEditingId(null);
    },
  });

  // Accumulate paginated photos
  const allPhotos = useMemo(() => {
    if (!photosQuery.data) return photosAccumRef.current;
    const d = photosQuery.data as {
      items: PhotoOutput[];
      total: number;
      page: number;
    };
    if (d.page === 1) {
      photosAccumRef.current = d.items;
    } else {
      const existingIds = new Set(photosAccumRef.current.map((p) => p.id));
      const newItems = d.items.filter((p) => !existingIds.has(p.id));
      photosAccumRef.current = [...photosAccumRef.current, ...newItems];
    }
    return photosAccumRef.current;
  }, [photosQuery.data]);

  const photosTotal = (photosQuery.data as { total: number })?.total ?? 0;
  const photosHasMore = allPhotos.length < photosTotal;

  const handleSelectPerson = useCallback((person: PersonOutput) => {
    photosAccumRef.current = [];
    setPhotosPage(1);
    setView({ level: "detail", person });
  }, []);

  // Auto-navigate to a specific person when navigateToPersonId is set
  useEffect(() => {
    if (!navigateToPersonId || !personsQuery.data) return;
    const person = personsQuery.data.find((p) => p.id === navigateToPersonId);
    if (person) {
      handleSelectPerson(person);
    }
    onNavigateToPersonHandled?.();
  }, [
    navigateToPersonId,
    personsQuery.data,
    handleSelectPerson,
    onNavigateToPersonHandled,
  ]);

  const handleBack = useCallback(() => {
    setView({ level: "grid" });
  }, []);

  const loadMore = useCallback(() => {
    setPhotosPage((p) => p + 1);
  }, []);

  const startRename = useCallback(
    (e: React.MouseEvent, person: PersonOutput) => {
      e.stopPropagation();
      setEditingId(person.id);
      setEditName(person.name ?? "");
    },
    [],
  );

  const submitRename = useCallback(
    (personId: string) => {
      if (!appId) return;
      renameMutation.mutate({
        id: appId,
        personId,
        name: editName.trim(),
      });
    },
    [appId, editName, renameMutation],
  );

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  // Breadcrumb
  const breadcrumb = useMemo(() => {
    const items: { label: string; onClick?: () => void }[] = [
      {
        label: "全部人物",
        onClick:
          view.level !== "grid" ? () => setView({ level: "grid" }) : undefined,
      },
    ];
    if (view.level === "detail" && view.person) {
      items.push({ label: view.person.name ?? "未命名" });
    }
    return items;
  }, [view]);

  if (personsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spin />
      </div>
    );
  }

  const persons = personsQuery.data ?? [];

  if (persons.length === 0) {
    return (
      <Empty description="暂无人脸数据。请先配置 AI 服务并触发人脸检测。" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-4 text-sm">
        {breadcrumb.map((item, i) => (
          <span key={item.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-fg-muted" />}
            {item.onClick ? (
              <button
                type="button"
                className="cursor-pointer text-blue-500 hover:text-blue-600 hover:underline dark:text-blue-400"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <span className="font-medium text-fg-secondary">
                {item.label}
              </span>
            )}
          </span>
        ))}
        <span className="ml-2 text-fg-muted">
          {view.level === "detail"
            ? `${photosTotal} 张照片`
            : `${persons.length} 位人物`}
        </span>
      </div>

      {/* Person grid */}
      {view.level === "grid" && (
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {persons.map((person) => (
            <button
              type="button"
              key={person.id}
              className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-border-base bg-surface-raised p-4 text-center transition-colors hover:bg-fill-tertiary "
              onClick={() => handleSelectPerson(person)}
            >
              {/* Avatar */}
              <div className="relative h-20 w-20 overflow-hidden rounded-full bg-fill-tertiary dark:bg-white/[0.10]">
                {person.avatarPhotoId ? (
                  <img
                    src={thumbUrl("photo", person.avatarPhotoId, 160)}
                    alt={person.name ?? "未命名"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User className="h-8 w-8 text-fg-muted" />
                  </div>
                )}
              </div>

              {/* Name + rename */}
              <div className="flex w-full min-w-0 items-center justify-center gap-1">
                {editingId === person.id ? (
                  <fieldset
                    className="flex w-full min-w-0 flex-nowrap items-center justify-center gap-1 border-0 p-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing)
                        submitRename(person.id);
                      if (e.key === "Escape") cancelRename();
                    }}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-border-base bg-surface-raised px-1.5 py-0.5 text-center text-sm text-fg-primary"
                    />
                    <Button
                      size="small"
                      className="h-7 w-7 shrink-0 p-0"
                      title="确认"
                      aria-label="确认"
                      onClick={(e) => {
                        e.stopPropagation();
                        submitRename(person.id);
                      }}
                      loading={renameMutation.isPending}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </fieldset>
                ) : (
                  <>
                    <span className="truncate text-sm font-medium text-fg-primary">
                      {person.name ?? "未命名"}
                    </span>
                    <Pencil
                      className="h-3 w-3 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => startRename(e, person)}
                    />
                  </>
                )}
              </div>

              {/* Face count */}
              <span className="text-xs text-fg-muted">
                {person.faceCount} 张照片
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Person detail */}
      {view.level === "detail" && (
        <>
          <div className="px-4">
            <Button
              variant="text"
              onClick={handleBack}
              className="mb-2 text-sm"
            >
              <Users className="mr-1 h-3.5 w-3.5" />
              返回全部人物
            </Button>
          </div>
          {allPhotos.length > 0 ? (
            <PhotoTimeline
              photos={allPhotos}
              appId={appId!}
              total={photosTotal}
              hasMore={photosHasMore}
              onLoadMore={loadMore}
              isLoadingMore={photosQuery.isFetching && photosPage > 1}
              onToggleFavorite={onToggleFavorite}
              isSelecting={isSelecting}
              selectedIds={selectedIds}
              onSelect={onSelect}
              targetRowHeight={targetRowHeight}
            />
          ) : photosQuery.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spin />
            </div>
          ) : (
            <Empty description="该人物暂无照片" />
          )}
        </>
      )}
    </div>
  );
}
