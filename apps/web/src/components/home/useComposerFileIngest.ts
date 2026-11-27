import { type ChangeEvent, type RefObject, useRef, useState } from "react";
import {
  type ComposerEmbed,
  createFileDropHandlers,
  isImageFile,
  loadFileEmbeds,
  MAX_BATCH_FILES,
  trackLoadedBlobUrls,
  uploadImageAttachment,
} from "./composerEmbeds.ts";

export function useComposerFileIngest({
  blobUrlsRef,
  insertEmbeds,
}: {
  readonly blobUrlsRef: RefObject<Set<string>>;
  readonly insertEmbeds: (embeds: ReadonlyArray<ComposerEmbed>) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dragDepthRef = useRef(0);

  const addFiles = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    const imageCount = files.slice(0, MAX_BATCH_FILES).filter(isImageFile).length;
    setUploadError(null);
    if (imageCount > 0) setUploadingCount((n) => n + imageCount);
    try {
      let firstError: string | null = null;
      const loaded = await loadFileEmbeds(files, {
        uploadAttachment: uploadImageAttachment,
        onError: (message) => {
          firstError ??= message;
        },
      });
      trackLoadedBlobUrls(blobUrlsRef.current, loaded);
      if (loaded.length > 0) insertEmbeds(loaded);
      if (firstError !== null) setUploadError(firstError);
    } finally {
      if (imageCount > 0) setUploadingCount((n) => Math.max(0, n - imageCount));
    }
  };

  const onFilesPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await addFiles(Array.from(files));
    event.target.value = "";
  };

  const dropHandlers = createFileDropHandlers({
    depthRef: dragDepthRef,
    setDragging,
    onFiles: (files) => void addFiles(files),
  });

  return {
    dragging,
    uploadingCount,
    uploadError,
    clearUploadError: () => setUploadError(null),
    addFiles,
    onFilesPicked,
    dropHandlers,
  };
}
