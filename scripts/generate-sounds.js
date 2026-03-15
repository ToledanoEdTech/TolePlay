#!/usr/bin/env node
/**
 * Generates shoot.mp3 and hit.mp3 for Zombie Defense game.
 * Uses raw WAV generation (no external deps) - outputs .wav for browser compatibility.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'sounds');

function createWavBuffer(samples, sampleRate = 44100) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const dataSize = samples.length * 2; // 16-bit = 2 bytes per sample
  const headerSize = 44;

  const buffer = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2;  // PCM
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(byteRate, offset); offset += 4;
  buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), offset);
    offset += 2;
  }

  return buffer;
}

// Shoot: short "pew" - quick attack, high pitch, fast decay
function generateShoot() {
  const sampleRate = 44100;
  const duration = 0.12; // seconds
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  const freq = 1200;
  const decay = 0.92;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 35) * (1 - i / numSamples);
    const tone = Math.sin(2 * Math.PI * freq * t) * envelope;
    const noise = (Math.random() * 2 - 1) * envelope * 0.15;
    samples[i] = (tone + noise) * 0.6;
  }

  return createWavBuffer(samples, sampleRate);
}

// Hit: short thud - low frequency impact
function generateHit() {
  const sampleRate = 44100;
  const duration = 0.15;
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  const freq = 80;
  const decay = 0.92;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 25) * Math.pow(1 - i / numSamples, 0.5);
    const tone = Math.sin(2 * Math.PI * freq * t) * envelope;
    const noise = (Math.random() * 2 - 1) * envelope * 0.15;
    samples[i] = (tone + noise) * 0.7;
  }

  return createWavBuffer(samples, sampleRate);
}

// Run
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

fs.writeFileSync(path.join(OUTPUT_DIR, 'shoot.wav'), generateShoot());
fs.writeFileSync(path.join(OUTPUT_DIR, 'hit.wav'), generateHit());

console.log('Generated sounds: public/sounds/shoot.wav, public/sounds/hit.wav');
