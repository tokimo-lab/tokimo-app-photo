import { Button, Empty, Spin } from "@tokiomo/components";
import { ChevronRight, Pencil, User, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import type { PersonOutput } from "../../generated/rust-types/index";
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
  const [view, setView] = useState<ViewState>({ level: "grid" });
  const [photosPage, setPhotosPage] = useState(1);
  const photosAccumRef = useRef<PhotoOutput[]>([]);

  // Rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const personsQuery = api.photoSettings.listPersons.useQuery(
    { appId: appId! },
    { enabled: !!appId },
  );

  const photosQuery = api.photoSettings.personPhotos.useQuery(
    {
      appId: appId!,
      personId: view.person?.id ?? "",
      page: photosPage,
      pageSize: PAGE_SIZE,
    },
    { enabled: !!appId && view.level === "detail" && !!view.person },
  );

  const renameMutation = api.photoSettings.renamePerson.useMutation({
    onSuccess: () => {
      void personsQuery.refetch();
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
        appId,
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
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />}
            {item.onClick ? (
              <button
                type="button"
                className="cursor-pointer text-blue-500 hover:text-blue-600 hover:underline dark:text-blue-400"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ) : (
              <span className="font-medium text-neutral-700 dark:text-neutral-200">
                {item.label}
              </span>
            )}
          </span>
        ))}
        <span className="ml-2 text-neutral-400 dark:text-neutral-500">
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
              className="group flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-neutral-200 bg-white p-4 text-center transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-750"
              onClick={() => handleSelectPerson(person)}
            >
              {/* Avatar */}
              <div className="relative h-20 w-20 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-700">
                {person.avatarPhotoId ? (
                  <img
                    src={`/api/photos/${person.avatarPhotoId}/thumbnail`}
                    alt={person.name ?? "未命名"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <User className="h-8 w-8 text-neutral-400 dark:text-neutral-500" />
                  </div>
                )}
              </div>

              {/* Name + rename */}
              <div className="flex w-full min-w-0 items-center justify-center gap-1">
                {editingId === person.id ? (
                  <fieldset
                    className="flex items-center gap-1 border-0 p-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(person.id);
                      if (e.key === "Escape") cancelRename();
                    }}
                  >
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-24 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-center text-sm dark:border-neutral-600 dark:bg-neutral-700 dark:text-neutral-100"
                    />
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        submitRename(person.id);
                      }}
                      loading={renameMutation.isPending}
                    >
                      确定
                    </Button>
                  </fieldset>
                ) : (
                  <>
                    <span className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {person.name ?? "未命名"}
                    </span>
                    <Pencil
                      className="h-3 w-3 shrink-0 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => startRename(e, person)}
                    />
                  </>
                )}
              </div>

              {/* Face count */}
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
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
