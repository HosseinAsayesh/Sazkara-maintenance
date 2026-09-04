'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from './ui';

/**
 * Finger/mouse signature capture. Written directly against pointer events rather than
 * pulling in a signature library: it is ~80 lines, and the libraries in this space still
 * carry React 18 peer ranges.
 *
 * The canvas is sized from its own layout box at device pixel ratio so a signature drawn
 * on a phone isn't a blurry upscale in the evidence PDF.
 */

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
}

export function SignaturePad({
  ref,
  label,
  onChange,
}: {
  ref?: React.Ref<SignaturePadHandle>;
  label?: string;
  onChange?: (hasInk: boolean) => void;
}) {
  const t = useTranslations('form');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Re-sizing clears the bitmap, so preserve what's drawn.
    const previous = canvas.width ? canvas.toDataURL() : null;

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';

    if (previous) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = previous;
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pointFrom(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk) {
      setHasInk(true);
      onChange?.(true);
    }
  };

  const end = () => {
    drawing.current = false;
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onChange?.(false);
  }, [onChange]);

  useImperativeHandle(
    ref,
    () => ({
      isEmpty: () => !hasInk,
      clear,
      toBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || !hasInk) return resolve(null);
          canvas.toBlob((blob) => resolve(blob), 'image/png');
        }),
    }),
    [hasInk, clear],
  );

  return (
    <div>
      {label ? (
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">
            {label} <span className="text-red-500">*</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            {t('clearSignature')}
          </Button>
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        className="touch-none h-36 w-full cursor-crosshair rounded-lg border border-dashed border-[var(--border)] bg-white"
      />
      <p className="mt-1 text-xs text-[var(--muted)]">{t('signatureHelp')}</p>
    </div>
  );
}
