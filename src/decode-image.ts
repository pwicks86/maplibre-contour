/* eslint-disable no-restricted-globals */
import type Actor from "./actor";
import { offscreenCanvasSupported } from "./utils";
import type { MainThreadDispatch } from "./remote-dem-manager";
import { CancelablePromise, DemTile, Encoding } from "./types";
import PNG from 'png-ts';
// import { DemSource } from "./dem-source";
// import fs from 'fs';


let offscreenCanvas: OffscreenCanvas;
let offscreenContext: OffscreenCanvasRenderingContext2D | null;
let canvas: HTMLCanvasElement;
let canvasContext: CanvasRenderingContext2D | null;

/**
 * Parses a `raster-dem` image into a DemTile using OffscreenCanvas and createImageBitmap
 * only supported on newer browsers.
 */
function decodeImageModern(
  blob: Blob,
  encoding: Encoding,
): CancelablePromise<DemTile> {
  let canceled = false;
  const promise = createImageBitmap(blob).then((img) => {
    if (canceled) return null as any as DemTile;
    if (!offscreenCanvas) {
      offscreenCanvas = new OffscreenCanvas(img.width, img.height);
      offscreenContext = offscreenCanvas.getContext("2d", {
        willReadFrequently: true,
      }) as OffscreenCanvasRenderingContext2D;
    }

    return getElevations(img, encoding, offscreenCanvas, offscreenContext);
  });
  return {
    value: promise,
    cancel: () => {
      canceled = true;
    },
  };
}

/**
 * Parses a `raster-dem` image into a DemTile using `<img>` element drawn to a `<canvas>`.
 * Only works on the main thread, but works across all browsers.
 */
function decodeImageOld(
  blob: Blob,
  encoding: Encoding,
): CancelablePromise<DemTile> {
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvasContext = canvas.getContext("2d", {
      willReadFrequently: true,
    }) as CanvasRenderingContext2D;
  }
  let canceled = false;
  const img: HTMLImageElement = new Image();
  const value = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => {
      if (!canceled) resolve(img);
      URL.revokeObjectURL(img.src);
      img.onload = null;
    };
    img.onerror = () => reject(new Error("Could not load image."));
    img.src = blob.size ? URL.createObjectURL(blob) : "";
  }).then((img: HTMLImageElement) =>
    getElevations(img, encoding, canvas, canvasContext),
  );
  return {
    value,
    cancel: () => {
      canceled = true;
      img.src = "";
    },
  };
}

/**
 * Parses a `raster-dem` image in a worker that doesn't support OffscreenCanvas and createImageBitmap
 * by running decodeImageOld on the main thread and returning the result.
 */
function decodeImageOnMainThread(
  blob: Blob,
  encoding: Encoding,
): CancelablePromise<DemTile> {
  return ((self as any).actor as Actor<MainThreadDispatch>).send(
    "decodeImage",
    [],
    undefined,
    blob,
    encoding,
  );
}

function isWorker(): boolean {
  return (
    // @ts-ignore
    typeof WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    // @ts-ignore
    self instanceof WorkerGlobalScope
  );
}

function isNodeJs(): boolean {
  return (typeof window === 'undefined');
}



function decodeImageNode(
  blob: Blob,
  encoding: Encoding,
): CancelablePromise<DemTile> {

  const value = (async () => {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8View = new Uint8Array(arrayBuffer);
    let png = PNG.load(uint8View);
    // console.log(png);
    return  {
      "width": png.width,
      "height": png.height,
      "pixels": png.decodePixels()
    };
  })().then( (pngStuff) => {
    let pixels = new Uint8ClampedArray(pngStuff["pixels"]);
    return decodeParsedImage(pngStuff["width"], pngStuff["height"], encoding, pixels);
  });

  let canceled = false;
  // const img: HTMLImageElement = new Image();
  // const value = new Promise<HTMLImageElement>((resolve, reject) => {
  //   img.onload = () => {
  //     if (!canceled) resolve(img);
  //     URL.revokeObjectURL(img.src);
  //     img.onload = null;
  //   };
  //   img.onerror = () => reject(new Error("Could not load image."));
  //   img.src = blob.size ? URL.createObjectURL(blob) : "";
  // }).then((img: HTMLImageElement) =>
  //   getElevations(img, encoding, canvas, canvasContext),
  // );
  // console.log(value);
  return {
    value,
    cancel: () => {
      canceled = true;
      // img.src = "";
    },
  };
}

const defaultDecoder: (
  blob: Blob,
  encoding: Encoding,
) => CancelablePromise<DemTile> = offscreenCanvasSupported()
  ? decodeImageModern
  : isWorker()
  ? decodeImageOnMainThread
  : isNodeJs()
  ? decodeImageNode
  : decodeImageOld;

export default defaultDecoder;

export let pngs: Array<any> = []

function getElevations(
  img: ImageBitmap | HTMLImageElement,
  encoding: Encoding,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  canvasContext:
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null,
): DemTile {
  canvas.width = img.width;
  canvas.height = img.height;

  if (!canvasContext) throw new Error("failed to get context");

  canvasContext.drawImage(img, 0, 0, img.width, img.height);

  const rgba = canvasContext.getImageData(0, 0, img.width, img.height).data;
  return decodeParsedImage(img.width, img.height, encoding, rgba);
}

export function decodeParsedImage(
  width: number,
  height: number,
  encoding: Encoding,
  input: Uint8ClampedArray,
): DemTile {
  const decoder: (r: number, g: number, b: number) => number =
    encoding === "mapbox"
      ? (r, g, b) => -10000 + (r * 256 * 256 + g * 256 + b) * 0.1
      : (r, g, b) => r * 256 + g + b / 256 - 32768;
  const data = new Float32Array(width * height);
  for (let i = 0; i < input.length; i += 4) {
    // console.log(`RGB(${input[i]}, ${input[i+1]}, ${input[i+2]})`)
    // debugger;
    data[i / 4] = decoder(input[i], input[i + 1], input[i + 2]);
    // console.log(`data(${data[i/4]})`);
  }
  // debugger;
  return { width, height, data };
}
