// Export a transient run's saved time steps as an animated GIF or a video:
// show each frame in the Results view, capture the view (with legend and
// time), and encode. The colour range can be held fixed over all frames so
// colours mean the same thing from start to end.

import { GifEncoder } from './gifEncoder';
import { composeView, downloadBlob, type ExportLegend } from './exportView';

export interface AnimationOptions {
  format: 'gif' | 'video';
  fps: number;
  /** First and last frame index, inclusive. */
  from: number;
  to: number;
  /** One colour range for every frame, from all of them. */
  sameRange: boolean;
  /** Write the time on each frame. */
  showTime: boolean;
}

export interface AnimationHost {
  root: HTMLElement;
  times: number[];
  /** A frame's field data (fetched or cached), or null if it failed. */
  fetchFrame: (index: number) => Promise<any | null>;
  /** Put a frame's data on screen. */
  showFrame: (index: number, data: any) => void;
  /** The automatic colour range of the shown field for some frame data. */
  frameRange: (data: any) => [number, number] | null;
  /** Hold the colour range (null releases it). */
  holdRange: (r: [number, number] | null) => void;
  /** The legend for a colour range. */
  legend: (r: [number, number] | null) => ExportLegend | null;
  /** The range on screen now, when not held. */
  currentRange: () => [number, number] | null;
  name: string;
  onProgress: (fraction: number, text: string) => void;
  cancelled: () => boolean;
}

/** A recordable video type in this browser, or null. */
export function videoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ])
    if (MediaRecorder.isTypeSupported(m)) return m;
  return null;
}

const nextPaint = () =>
  new Promise<void>((res) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 40))),
  );

/** Run the export; resolves to null when done or cancelled, else an error. */
export async function exportAnimation(
  o: AnimationOptions,
  h: AnimationHost,
): Promise<string | null> {
  const frames: number[] = [];
  for (let i = o.from; i <= o.to; i++) frames.push(i);
  if (frames.length < 2) return 'Pick at least two frames.';

  // One range over every frame: read them all first.
  let held: [number, number] | null = null;
  if (o.sameRange) {
    let lo = Infinity,
      hi = -Infinity;
    for (let k = 0; k < frames.length; k++) {
      if (h.cancelled()) return null;
      h.onProgress((0.3 * k) / frames.length, `Reading frame ${k + 1} of ${frames.length}`);
      const d = await h.fetchFrame(frames[k]);
      const r = d ? h.frameRange(d) : null;
      if (r) {
        lo = Math.min(lo, r[0]);
        hi = Math.max(hi, r[1]);
      }
    }
    if (hi > lo) held = [lo, hi];
  }

  const box = h.root.getBoundingClientRect();
  // GIFs grow fast with size: cap them at 960 px wide; video at 1600.
  const maxW = o.format === 'gif' ? 960 : 1600;
  const scale = Math.min(window.devicePixelRatio || 1, maxW / box.width);
  // Video encoders want even sizes.
  const W = Math.max(2, Math.floor((box.width * scale) / 2) * 2);
  const H = Math.max(2, Math.floor((box.height * scale) / 2) * 2);
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = W;
  frameCanvas.height = H;
  const fctx = frameCanvas.getContext('2d', { willReadFrequently: o.format === 'gif' });
  if (!fctx) return 'Could not draw the frames.';

  const gif = o.format === 'gif' ? new GifEncoder(W, H) : null;
  let recorder: MediaRecorder | null = null;
  let track: CanvasCaptureMediaStreamTrack | null = null;
  const chunks: Blob[] = [];
  const mime = o.format === 'video' ? videoMime() : null;
  if (o.format === 'video') {
    if (!mime) return 'This app cannot record video here. Export a GIF instead.';
    const stream = frameCanvas.captureStream(0);
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.start();
  }

  h.holdRange(held);
  try {
    for (let k = 0; k < frames.length; k++) {
      if (h.cancelled()) {
        recorder?.stop();
        return null;
      }
      const base = o.sameRange ? 0.3 : 0;
      h.onProgress(base + ((1 - base) * k) / frames.length, `Frame ${k + 1} of ${frames.length}`);
      const d = await h.fetchFrame(frames[k]);
      if (!d) continue;
      h.showFrame(frames[k], d);
      await nextPaint();
      const t = h.times[frames[k]];
      const shot = composeView(
        h.root,
        h.legend(held ?? h.currentRange()),
        o.showTime ? `t = ${Number(t.toPrecision(5))} s` : undefined,
        scale,
      );
      if (!shot) continue;
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, W, H);
      fctx.drawImage(shot, 0, 0, W, H);
      if (gif) gif.addFrame(fctx.getImageData(0, 0, W, H).data, 1000 / o.fps);
      else {
        track?.requestFrame();
        // The recorder keeps real time: hold each frame for its duration.
        await new Promise((r) => setTimeout(r, 1000 / o.fps));
      }
    }
  } finally {
    h.holdRange(null);
  }

  let blob: Blob;
  if (gif) blob = gif.finish();
  else {
    const rec = recorder!;
    await new Promise<void>((res) => {
      rec.onstop = () => res();
      rec.stop();
    });
    blob = new Blob(chunks, { type: mime!.split(';')[0] });
  }
  const ext = gif ? 'gif' : mime!.startsWith('video/mp4') ? 'mp4' : 'webm';
  downloadBlob(blob, `${h.name}.${ext}`);
  h.onProgress(1, 'Done');
  return null;
}
