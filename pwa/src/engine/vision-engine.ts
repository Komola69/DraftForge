/**
 * VisionEngine: Experimental Computer Vision for MLBB Draft Auto-Pilot.
 * Uses Canvas-based image processing and Mean Squared Error (MSE) on downscaled
 * grayscale images to match screenshots of heroes to our portrait database.
 */

import type { Hero } from './types';
import portraitMap from '../../../data/processed/v1_portraits.json';
import { DataLoader } from './data-loader';

// For speed, we downscale all comparisons to a tiny 16x16 matrix.
const HASH_SIZE = 16;
const PIXEL_COUNT = HASH_SIZE * HASH_SIZE;

export class VisionEngine {
  private loader: DataLoader;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private templates: Map<number, Uint8ClampedArray> = new Map();
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
          // Draw image to our 16x16 canvas
          this.ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
          const imageData = this.ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
          const grayscale = this.toGrayscale(imageData.data);
          this.templates.set(hero.id, grayscale);
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

    this.ctx.drawImage(image, 0, 0, HASH_SIZE, HASH_SIZE);
    const imageData = this.ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    const targetGrayscale = this.toGrayscale(imageData.data);

    let bestMatchId: number | null = null;
    let lowestError = Infinity;

    // Compare against all loaded templates
    for (const [heroId, templatePixels] of this.templates.entries()) {
      const error = this.calculateMSE(targetGrayscale, templatePixels);
      if (error < lowestError) {
        lowestError = error;
        bestMatchId = heroId;
      }
    }

    // Threshold logic: If lowest error is too high, it's not a valid hero icon (e.g. empty slot)
    const ERROR_THRESHOLD = 5000; 
    if (lowestError > ERROR_THRESHOLD) {
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
   * Calculates Mean Squared Error between two pixel arrays of the same length.
   * Lower score = more identical.
   */
  private calculateMSE(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let sum = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const diff = a[i] - b[i];
      sum += (diff * diff);
    }
    return sum / PIXEL_COUNT;
  }
}
