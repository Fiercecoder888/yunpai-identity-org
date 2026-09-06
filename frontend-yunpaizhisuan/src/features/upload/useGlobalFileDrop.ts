import { useEffect, useRef, useState } from 'react';
import { classifyFiles, pickDropDestination, type DropDestination } from './fileClassify';

type DragLikeEvent = {
  dataTransfer: DataTransfer | null;
  preventDefault?: () => void;
};

const hasFilesInDrag = (event: DragLikeEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files');

export type DroppedFilesResult = {
  destination: DropDestination | null;
  orderFiles: File[];
  m0Files: File[];
};

export function handleDropFiles(files: File[]): DroppedFilesResult {
  const classified = classifyFiles(files);
  return {
    destination: pickDropDestination(files),
    orderFiles: classified.order,
    m0Files: classified.m0,
  };
}

export function useGlobalFileDrop({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const counterRef = useRef(0);
  const onFilesRef = useRef(onFiles);

  useEffect(() => {
    onFilesRef.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    const onWindowDragEnter = (event: DragEvent) => {
      if (!hasFilesInDrag(event)) return;
      counterRef.current += 1;
      setIsDragging(true);
    };
    const onWindowDragOver = (event: DragEvent) => {
      if (hasFilesInDrag(event)) {
        event.preventDefault();
      }
    };
    const onWindowDragLeave = (event: DragEvent) => {
      if (!hasFilesInDrag(event)) return;
      if (!event.relatedTarget) {
        counterRef.current = 0;
        setIsDragging(false);
        return;
      }
      counterRef.current = Math.max(0, counterRef.current - 1);
      if (counterRef.current === 0) {
        setIsDragging(false);
      }
    };
    const onWindowDrop = (event: DragEvent) => {
      if (!hasFilesInDrag(event)) return;
      event.preventDefault();
      counterRef.current = 0;
      setIsDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) {
        onFilesRef.current(files);
      }
    };
    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  const cancelDrag = () => {
    counterRef.current = 0;
    setIsDragging(false);
  };

  return { isDragging, cancelDrag };
}
