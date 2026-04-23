/**
 * VisionEngine: Experimental Computer Vision for MLBB Draft Auto-Pilot.
 * Uses Canvas-based image processing and Difference Hash (dHash)
 * to match screenshots of heroes to our portrait database.
 */

import portraitMap from '../../../data/processed/v1_portraits.json';
import { DataLoader } from './data-loader';

// dHash uses a 16x16 grid = 256 pixels
const HASH_SIZE = 16;
const PIXEL_COUNT = HASH_SIZE * HASH_SIZE;

export class VisionEngine {
  private loader: DataLoader;
  /** Cache: heroId → array of 256-bit signatures (as 4x 64-bit BigInts) */
  private templates: Map<number, BigInt64Array[]> = new Map();
  private loaded = false;

  constructor(loader: DataLoader) {
    this.loader = loader;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const heroes = this.loader.getAllHeroes();
    
    const basePromises = heroes.map(hero => {
      return new Promise<void>((resolve) => {
        const path = (portraitMap as Record<string, string>)[hero.name.toLowerCase()];
        if (!path) { resolve(); return; }
        this.addSignature(hero.id, path).finally(() => resolve());
      });
    });

    await Promise.all(basePromises);
    this.loaded = true;
    const totalSigs = Array.from(this.templates.values()).reduce((sum, sigs) => sum + sigs.length, 0);
    console.log(`[VisionEngine] 16x16 High-Res dHash Active. Loaded ${totalSigs} signatures.`);
  }

  private generateHash(image: HTMLImageElement | HTMLCanvasElement): BigInt64Array | null {
    if (!image.width || !image.height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = HASH_SIZE;
    canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const isPortrait = image.width < 300 && image.height < 300;
    let sx = 0, sy = 0, sw = image.width, sh = image.height;
    
    if (!isPortrait) {
      sx = image.width * 0.15;
      sy = image.height * 0.05;
      sw = image.width * 0.70;
      sh = image.height * 0.40;
    }

    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, HASH_SIZE, HASH_SIZE);
    const imageData = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE);
    const grayscale = this.toGrayscale(imageData.data);
    
    // 256 bits = 4 * 64 bits
    const hash = new BigInt64Array(4);
    for (let chunk = 0; chunk < 4; chunk++) {
        let chunkHash = 0n;
        for (let j = 0; j < 64; j++) {
            const idx = (chunk * 64) + j;
            const current = grayscale[idx];
            const next = (idx === PIXEL_COUNT - 1) ? grayscale[0] : grayscale[idx + 1];
            if (current > next) {
                chunkHash |= (1n << BigInt(j));
            }
        }
        hash[chunk] = chunkHash;
    }
    return hash;
  }

  private async addSignature(heroId: number, path: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        const hash = this.generateHash(img);
        if (hash !== null) {
          if (!this.templates.has(heroId)) {
            this.templates.set(heroId, []);
          }
          this.templates.get(heroId)!.push(hash);
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = path;
    });
  }

  identifyHero(image: HTMLImageElement | HTMLCanvasElement): number | null {
    if (!this.loaded || this.templates.size === 0) return null;

    const targetHash = this.generateHash(image);
    if (targetHash === null) return null;

    let bestMatchId: number | null = null;
    let lowestDistance = Infinity;

    for (const [heroId, signatureHashes] of this.templates.entries()) {
      for (const templateHash of signatureHashes) {
        let totalDistance = 0;
        for (let i = 0; i < 4; i++) {
            totalDistance += this.getHammingDistance(targetHash[i], templateHash[i]);
        }
        if (totalDistance < lowestDistance) {
          lowestDistance = totalDistance;
          bestMatchId = heroId;
        }
      }
    }

    // Threshold for 256 bits: < 40 bits difference (~15%) is a match
    if (lowestDistance > 40) {
      return null;
    }

    return bestMatchId;
  }

  private toGrayscale(pixels: Uint8ClampedArray): Uint8ClampedArray {
    const grayscale = new Uint8ClampedArray(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const r = pixels[i * 4];
      const g = pixels[i * 4 + 1];
      const b = pixels[i * 4 + 2];
      grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
    return grayscale;
  }

  private getHammingDistance(h1: bigint, h2: bigint): number {
    let xor = h1 ^ h2;
    if (xor < 0n) xor = -xor; // Handle negative bit patterns if any
    let distance = 0;
    let x = xor;
    while (x > 0n) {
      distance += Number(x & 1n);
      x >>= 1n;
    }
    return distance;
  }
}
