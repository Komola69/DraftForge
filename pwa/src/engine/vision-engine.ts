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
  private templates: Map<number, bigint[]> = new Map();
  private loaded = false;

  constructor(loader: DataLoader) {
    this.loader = loader;
    this.canvas = document.createElement('canvas');
    this.canvas.width = HASH_SIZE;
    this.canvas.height = HASH_SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  /**
   * Initializes the engine by loading all hero portraits and skins into hidden canvases
   * and extracting their 8x8 grayscale signatures.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    const heroes = this.loader.getAllHeroes();
    
    // Load base portraits
    const basePromises = heroes.map(hero => {
      return new Promise<void>((resolve) => {
        const path = (portraitMap as Record<string, string>)[hero.name.toLowerCase()];
        if (!path) { resolve(); return; }
        this.addSignature(hero.id, path).finally(() => resolve());
      });
    });

    await Promise.all(basePromises);

    // Try to load skin portraits if available
    try {
      const skinsRes = await fetch('/data/processed/v1_skin_portraits.json');
      if (skinsRes.ok) {
        const skinMap = await skinsRes.json();
        const skinPromises: Promise<void>[] = [];
        
        for (const hero of heroes) {
          const skinPaths = skinMap[hero.name.toLowerCase()];
          if (skinPaths && Array.isArray(skinPaths)) {
            skinPaths.forEach(path => {
              skinPromises.push(this.addSignature(hero.id, path));
            });
          }
        }
        await Promise.all(skinPromises);
      }
    } catch (e) {
      console.warn('[VisionEngine] No additional skins loaded.');
    }

    this.loaded = true;
    const totalSigs = Array.from(this.templates.values()).reduce((sum, sigs) => sum + sigs.length, 0);
    console.log(`[VisionEngine] Loaded ${totalSigs} signatures for ${this.templates.size} heroes.`);
  }

  private async addSignature(heroId: number, path: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const sx = img.width * 0.15;
        const sy = img.height * 0.05;
        const sw = img.width * 0.70;
        const sh = img.height * 0.40;

        this.ctx.drawImage(img, sx, sy, sw, sh, 0, 0, HASH_SIZE, HASH_SIZE);
        const imageData = this.ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
        const grayscale = this.toGrayscale(imageData.data);
        const hash = this.calculateDHash(grayscale);
        
        if (!this.templates.has(heroId)) {
          this.templates.set(heroId, []);
        }
        this.templates.get(heroId)!.push(hash);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = path;
    });
  }

  /**
   * Identifies a hero from an HTMLImageElement or Canvas crop.
   */
  identifyHero(image: HTMLImageElement | HTMLCanvasElement): number | null {
    if (!this.loaded || this.templates.size === 0) return null;

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

    for (const [heroId, signatureHashes] of this.templates.entries()) {
      for (const templateHash of signatureHashes) {
        const distance = this.getHammingDistance(targetHash, templateHash);
        if (distance < lowestDistance) {
          lowestDistance = distance;
          bestMatchId = heroId;
        }
      }
    }

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
