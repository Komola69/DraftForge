/**
 * VisionEngine: Experimental Computer Vision for MLBB Draft Auto-Pilot.
 * Uses Canvas-based image processing and Mean Squared Error (MSE) on downscaled
 * grayscale images to match screenshots of heroes to our portrait database.
 */

import portraitMap from '../../../data/processed/v1_portraits.json';
import { DataLoader } from './data-loader';

// dHash uses an 8x8 grid = 64 pixels (fits in a 64-bit BigInt)
const HASH_SIZE = 8;
const PIXEL_COUNT = HASH_SIZE * HASH_SIZE;

export class VisionEngine {
  private loader: DataLoader;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private templates: Map<number, bigint> = new Map();
  private loaded = false;

  constructor(loader: DataLoader) {
    this.loader = loader;
    this.canvas = document.createElement('canvas');
    this.canvas.width = HASH_SIZE;
    this.canvas.height = HASH_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * Initializes the engine by loading all 131 hero portraits into hidden canvases
   * and extracting their 16x16 grayscale signatures.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    const heroes = this.loader.getAllHeroes();
    
    const promises = heroes.map(hero => {
      return new Promise<void>((resolve) => {
        const path = (portraitMap as Record<string, string>)[hero.name.toLowerCase()];
        if (!path) { resolve(); return; }

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          // Safe Zone: Top-Center 40% (sx=15%, sy=5%, sw=70%, sh=40%)
          const sx = img.width * 0.15;
          const sy = img.height * 0.05;
          const sw = img.width * 0.70;
          const sh = img.height * 0.40;

          // Draw cropped Safe Zone down to 8x8 canvas
          this.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, HASH_SIZE, HASH_SIZE);
          const imageData = this.ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
          const grayscale = this.toGrayscale(imageData.data);
          const hash = this.calculateDHash(grayscale);
          this.templates.set(hero.id, hash);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = path;
      });
    });

    await Promise.all(promises);
    this.loaded = true;
    console.log(`[VisionEngine] Loaded ${this.templates.size} hero signatures for OCR.`);
  }

  /**
   * Identifies a hero from an HTMLImageElement or Canvas crop.
   */
  identifyHero(image: HTMLImageElement | HTMLCanvasElement): number | null {
    if (!this.loaded || this.templates.size === 0) return null;

    // Safe Zone: Top-Center 40%
    const sx = image.width * 0.15;
    const sy = image.height * 0.05;
    const sw = image.width * 0.70;
    const sh = image.height * 0.40;

    this.ctx.drawImage(image, sx, sy, sw, sh, 0, 0, HASH_SIZE, HASH_SIZE);
    const imageData = this.ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    const targetGrayscale = this.toGrayscale(imageData.data);
    const targetHash = this.calculateDHash(targetGrayscale);

    let bestMatchId: number | null = null;
    let lowestDistance = Infinity;

    // Compare against all loaded templates
    for (const [heroId, templateHash] of this.templates.entries()) {
      const distance = this.getHammingDistance(targetHash, templateHash);
      if (distance < lowestDistance) {
        lowestDistance = distance;
        bestMatchId = heroId;
      }
    }

    // Threshold: <= 8 bits difference out of 64
    if (lowestDistance > 8) {
      return null;
    }

    return bestMatchId;
  }

  /**
   * Converts RGBA pixel data to a flat array of grayscale values.
   */
  private toGrayscale(pixels: Uint8ClampedArray): Uint8ClampedArray {
    const grayscale = new Uint8ClampedArray(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      // Standard luminance formula
      grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return grayscale;
  }

  /**
   * Generates a 64-bit Difference Hash (dHash) from grayscale pixels.
   */
  private calculateDHash(pixels: Uint8ClampedArray): bigint {
    let hash = 0n;
    for (let i = 0; i < 64; i++) {
      const current = pixels[i];
      const next = (i === 63) ? pixels[0] : pixels[i + 1];
      if (current > next) {
        hash |= (1n << BigInt(i));
      }
    }
    return hash;
  }

  /**
   * Calculates Hamming Distance (number of differing bits) between two BigInts.
   */
  private getHammingDistance(hash1: bigint, hash2: bigint): number {
    let xor = hash1 ^ hash2;
    let distance = 0;
    while (xor > 0n) {
      distance += Number(xor & 1n);
      xor >>= 1n;
    }
    return distance;
  }
}
